#!/usr/bin/env python3
"""
Python Worker for Batch Processing
Handles large file processing (5000+ rows) with memory-efficient chunking
"""

import redis
import json
import os
import pandas as pd
import numpy as np
from sqlalchemy import create_engine, text
import math
import sys
from datetime import datetime

# Configuration
REDIS_URL = os.getenv('REDIS_URL', 'redis://127.0.0.1:6379')
DB_URL = os.getenv('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5434/location_pockets')
UPLOAD_DIR = os.getenv('UPLOAD_DIR', '../backend/uploads')

# Grid configuration
METERS_PER_DEGREE_LAT = 111000
GRID_LEVELS = [500000, 100000, 20000, 5000, 1000]
DEFAULT_ORIGIN_LAT = 8.0
DEFAULT_ORIGIN_LON = 68.0
DEFAULT_ALPHABET = '0123456789ABCDEFGHJKLMNPQRSTUV'
MAX_POCKET_CENTER_DISTANCE_TOLERANCE_METERS = 250.0

# Initialize connections
print(f"🔌 Connecting to Redis: {REDIS_URL}")
redis_client = redis.from_url(REDIS_URL)

print(f"🔌 Connecting to PostgreSQL: {DB_URL.split('@')[1]}")  # Hide password
db_engine = create_engine(DB_URL, pool_pre_ping=True)

def parse_bool_flag(value, default=False):
    """Parse booleans from mixed string/bool payload values."""
    if value is None:
        return default

    if isinstance(value, bool):
        return value

    normalized = str(value).strip().lower()
    if not normalized:
        return default

    return normalized in ('1', 'true', 'yes', 'y', 'on')

def is_valid_geo_coordinate(lat, lon):
    """Validate latitude/longitude ranges."""
    return (
        isinstance(lat, (int, float))
        and isinstance(lon, (int, float))
        and not math.isnan(lat)
        and not math.isnan(lon)
        and -90.0 <= lat <= 90.0
        and -180.0 <= lon <= 180.0
    )

def sanitize_pocket_config(raw_config):
    """Normalize pocket config with safe defaults."""
    origin_lat = raw_config.get('originLat') if isinstance(raw_config, dict) else None
    origin_lon = raw_config.get('originLon') if isinstance(raw_config, dict) else None
    alphabet = raw_config.get('alphabet') if isinstance(raw_config, dict) else None

    parsed_origin_lat = float(origin_lat) if origin_lat is not None else float('nan')
    parsed_origin_lon = float(origin_lon) if origin_lon is not None else float('nan')
    parsed_alphabet = str(alphabet).strip() if alphabet is not None else ''

    return {
        'originLat': parsed_origin_lat if math.isfinite(parsed_origin_lat) else DEFAULT_ORIGIN_LAT,
        'originLon': parsed_origin_lon if math.isfinite(parsed_origin_lon) else DEFAULT_ORIGIN_LON,
        'alphabet': parsed_alphabet if len(parsed_alphabet) == 30 else DEFAULT_ALPHABET
    }

def max_expected_distance_for_pocket_level(pocket_level_size):
    """Maximum plausible customer->pocket-center distance for square cells."""
    return (float(pocket_level_size) * math.sqrt(2) / 2.0) + MAX_POCKET_CENTER_DISTANCE_TOLERANCE_METERS

def is_valid_nearest_pocket_candidate(candidate, pocket_level_size):
    """Validate nearest pocket output shape and plausibility."""
    if not isinstance(candidate, dict):
        return False

    try:
        pocket_id = str(candidate.get('pocketId', '')).strip()
        distance = float(candidate.get('distance'))
        center_lat = float(candidate.get('centerLat'))
        center_lon = float(candidate.get('centerLon'))
    except (TypeError, ValueError):
        return False

    return (
        pocket_id != ''
        and math.isfinite(distance)
        and distance >= 0.0
        and math.isfinite(center_lat)
        and math.isfinite(center_lon)
        and -90.0 <= center_lat <= 90.0
        and -180.0 <= center_lon <= 180.0
        and distance <= max_expected_distance_for_pocket_level(pocket_level_size)
    )

def resolve_nearest_pocket(customer_lat, customer_lon, raw_config, pocket_level_size=5000):
    """Resolve nearest pocket with fallback to default origin when config is incompatible."""
    primary_config = sanitize_pocket_config(raw_config)
    fallback_config = {
        'originLat': DEFAULT_ORIGIN_LAT,
        'originLon': DEFAULT_ORIGIN_LON,
        'alphabet': primary_config['alphabet']
    }
    should_try_fallback = (
        primary_config['originLat'] != fallback_config['originLat']
        or primary_config['originLon'] != fallback_config['originLon']
    )

    last_error = None

    def attempt(candidate_config, used_fallback):
        candidate = find_nearest_pocket(
            customer_lat,
            customer_lon,
            candidate_config,
            pocket_level_size=pocket_level_size
        )
        if not is_valid_nearest_pocket_candidate(candidate, pocket_level_size):
            raise ValueError("Invalid pocket assignment candidate produced by current configuration")
        return candidate, used_fallback

    try:
        return attempt(primary_config, False)
    except Exception as exc:
        last_error = exc

    if not should_try_fallback:
        raise last_error

    try:
        return attempt(fallback_config, True)
    except Exception as exc:
        last_error = exc

    raise last_error

def meters_per_degree_lon(latitude):
    """Calculate meters per degree longitude at given latitude"""
    lat_rad = math.radians(latitude)
    return METERS_PER_DEGREE_LAT * math.cos(lat_rad)

def lat_lon_to_meters(lat, lon, origin_lat, origin_lon):
    """Convert lat/lon to meters from origin"""
    delta_lat = lat - origin_lat
    delta_lon = lon - origin_lon
    
    meters_per_deg_lon = meters_per_degree_lon(lat)
    
    y = delta_lat * METERS_PER_DEGREE_LAT
    x = delta_lon * meters_per_deg_lon
    
    return x, y

def meters_to_lat_lon(x, y, origin_lat, origin_lon):
    """Convert meters to lat/lon from origin"""
    lat = origin_lat + (y / METERS_PER_DEGREE_LAT)
    meters_per_deg_lon = meters_per_degree_lon(lat)
    lon = origin_lon + (x / meters_per_deg_lon)
    return lat, lon

def calculate_indices(x, y):
    """Calculate row and column indices for all grid levels"""
    indices = []
    cumulative_x = 0
    cumulative_y = 0
    
    for i, level_size in enumerate(GRID_LEVELS):
        col = int((x - cumulative_x) // level_size)
        row = int((y - cumulative_y) // level_size)
        
        indices.append({
            'level': i,
            'levelSize': level_size,
            'row': row,
            'col': col
        })
        
        cumulative_x += col * level_size
        cumulative_y += row * level_size
    
    return indices

def encode_indices(indices, alphabet):
    """Encode indices to Pocket ID"""
    parts = []
    for idx in indices:
        row_char = alphabet[idx['row'] % 30]
        col_char = alphabet[idx['col'] % 30]
        parts.append(f"{row_char}{col_char}")
    return '-'.join(parts)

def decode_indices(pocket_id, alphabet):
    """Decode Pocket ID to indices"""
    parts = pocket_id.split('-')
    indices = []
    
    for i, part in enumerate(parts):
        row_char = part[0]
        col_char = part[1]
        row = alphabet.index(row_char)
        col = alphabet.index(col_char)
        
        indices.append({
            'level': i,
            'levelSize': GRID_LEVELS[i],
            'row': row,
            'col': col
        })
    
    return indices

def indices_to_meters(indices):
    """Calculate southwest corner coordinates from indices"""
    x = 0
    y = 0
    for idx in indices:
        x += idx['col'] * idx['levelSize']
        y += idx['row'] * idx['levelSize']
    return x, y

def decode_pocket_id(pocket_id, config):
    """Decode Pocket ID to center coordinates"""
    indices = decode_indices(pocket_id, config['alphabet'])
    sw_x, sw_y = indices_to_meters(indices)
    
    finest_level = indices[-1]['levelSize']
    center_x = sw_x + finest_level / 2
    center_y = sw_y + finest_level / 2
    
    center_lat, center_lon = meters_to_lat_lon(
        center_x, center_y,
        config['originLat'], config['originLon']
    )
    
    return center_lat, center_lon

def haversine_distance(lat1, lon1, lat2, lon2):
    """Calculate Haversine distance in meters"""
    R = 6371000
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    
    a = (math.sin(delta_phi / 2) ** 2 +
         math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2) ** 2)
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    
    return R * c

def find_nearest_pocket(customer_lat, customer_lon, config, pocket_level_size=5000):
    """Assign customer to the containing pocket cell at the configured pocket level."""
    x, y = lat_lon_to_meters(
        customer_lat, customer_lon,
        config['originLat'], config['originLon']
    )

    if pocket_level_size not in GRID_LEVELS:
        raise ValueError(f"Unsupported pocket level size: {pocket_level_size}")

    pocket_level_index = GRID_LEVELS.index(pocket_level_size)
    full_indices = calculate_indices(x, y)
    pocket_indices = full_indices[:pocket_level_index + 1]
    nearest_pocket_id = encode_indices(pocket_indices, config['alphabet'])
    center_lat, center_lon = decode_pocket_id(nearest_pocket_id, config)
    nearest_distance = haversine_distance(customer_lat, customer_lon, center_lat, center_lon)

    return {
        'pocketId': nearest_pocket_id,
        'distance': nearest_distance,
        'centerLat': center_lat,
        'centerLon': center_lon
    }

def get_branches():
    """Load all branches from database"""
    with db_engine.connect() as conn:
        result = conn.execute(text("SELECT id, lat, lon, pocket_id FROM branches"))
        branches = []
        for row in result:
            branches.append({
                'id': row[0],
                'lat': float(row[1]),
                'lon': float(row[2]),
                'pocketId': row[3]
            })
        return branches

def find_nearest_branch_for_pocket(pocket_lat, pocket_lon, branches):
    """Find nearest branch to a pocket center"""
    if not branches:
        return None
    
    nearest_branch = None
    nearest_distance = float('inf')
    
    for branch in branches:
        distance = haversine_distance(pocket_lat, pocket_lon, branch['lat'], branch['lon'])
        if distance < nearest_distance:
            nearest_distance = distance
            nearest_branch = {
                'branchId': branch['id'],
                'branchLat': branch['lat'],
                'branchLon': branch['lon'],
                'distance': distance
            }
    
    return nearest_branch

def find_nearest_branch_from_pocket_catalog(pocket_lat, pocket_lon, branch_pocket_catalog):
    """Find nearest branch by comparing customer pocket-center to pre-mapped branch pocket-centers."""
    if not branch_pocket_catalog:
        return None

    nearest_branch = None
    nearest_distance = float('inf')

    for branch in branch_pocket_catalog:
        branch_center_lat = branch.get('pocketCenterLat')
        branch_center_lon = branch.get('pocketCenterLon')
        if branch_center_lat is None or branch_center_lon is None:
            continue

        distance = haversine_distance(pocket_lat, pocket_lon, branch_center_lat, branch_center_lon)
        if distance < nearest_distance:
            nearest_distance = distance
            nearest_branch = {
                'branchId': branch['id'],
                'branchLat': branch['lat'],
                'branchLon': branch['lon'],
                'branchPocketId': branch.get('pocketId'),
                'branchPocketCenterLat': branch_center_lat,
                'branchPocketCenterLon': branch_center_lon,
                'distance': distance
            }

    return nearest_branch

def process_job(job_data):
    """Process a batch job"""
    job_id = job_data['jobId']
    file_path = job_data['filePath']
    config = job_data['config']
    replace_existing = parse_bool_flag(job_data.get('replaceExisting', False), False)
    
    # Normalize file path to avoid cwd-dependent failures from manually requeued jobs.
    if not os.path.isabs(file_path):
        file_path = os.path.abspath(file_path)
    if not os.path.exists(file_path):
        fallback_path = os.path.join(UPLOAD_DIR, os.path.basename(file_path))
        if os.path.exists(fallback_path):
            file_path = fallback_path
    print(f"🔄 Starting job {job_id} for {file_path}")
    
    # Update job to active
    with db_engine.connect() as conn:
        conn.execute(
            text("UPDATE jobs SET status = 'active' WHERE job_id = :job_id"),
            {"job_id": job_id}
        )
        conn.commit()
    
    try:
        # Read entire Excel file (pandas doesn't support chunksize for Excel)
        print(f"📊 Reading Excel file...")
        df = pd.read_excel(file_path, engine='openpyxl')
        total_rows = len(df)
        
        with db_engine.connect() as conn:
            conn.execute(
                text("UPDATE jobs SET total = :total WHERE job_id = :job_id"),
                {"total": total_rows, "job_id": job_id}
            )
            conn.commit()
        
        print(f"📝 Processing {total_rows} rows...")
        
        # Load branches once
        branches = get_branches()
        if not branches:
            raise Exception("No branches found in database")

        branch_lookup = {str(branch['id']).upper(): branch for branch in branches}
        branch_pocket_catalog = []
        
        processed_count = 0
        all_results = []
        all_mappings = []
        pocket_stats = {}
        pocket_centers = {}
        # --- ORIGINAL BACKUP ---
        # [IST 2026-03-09] fallback counters were disabled with pocket logic.
        # fallback_pocket_config_hits = 0
        fallback_pocket_config_hits = 0
        branch_pocket_fallback_hits = 0

        # Sequence guard: prepare branch pocket mapping first using the same pocket resolution path.
        for branch in branches:
            branch_lat = float(branch.get('lat'))
            branch_lon = float(branch.get('lon'))
            if not math.isfinite(branch_lat) or not math.isfinite(branch_lon):
                continue

            try:
                branch_pocket_assignment, used_fallback = resolve_nearest_pocket(
                    branch_lat,
                    branch_lon,
                    config,
                    pocket_level_size=5000
                )
                if used_fallback:
                    branch_pocket_fallback_hits += 1
                branch_pocket_catalog.append({
                    'id': branch['id'],
                    'lat': branch_lat,
                    'lon': branch_lon,
                    'pocketId': branch_pocket_assignment.get('pocketId'),
                    'pocketCenterLat': branch_pocket_assignment.get('centerLat'),
                    'pocketCenterLon': branch_pocket_assignment.get('centerLon')
                })
            except Exception as branch_error:
                print(f"  ⚠️  Skipping branch {branch.get('id')} from pocket catalog: {branch_error}")

        if not branch_pocket_catalog:
            raise Exception("No valid branch pocket mappings were generated. Verify branch coordinates and pocket origin configuration.")
        
        # Process in chunks (split dataframe into chunks)
        chunk_size = 5000
        # Standardize column names
        df.columns = [col.lower() for col in df.columns]
        
        # Find coordinate columns
        lat_col = next((c for c in ['canon_lat', 'latitude', 'lat'] if c in df.columns), None)
        lon_col = next((c for c in ['canon_long', 'longitude', 'lon'] if c in df.columns), None)
        id_col = next((c for c in ['lan', 'customerid', 'customer_id', 'id'] if c in df.columns), None)
        branch_col = next((c for c in ['branch_code', 'branchcode', 'branch code'] if c in df.columns), None)
        
        if not lat_col or not lon_col:
            raise ValueError("Could not find latitude/longitude columns")
        
        # Process dataframe in chunks
        for chunk_num in range(0, len(df), chunk_size):
            chunk = df.iloc[chunk_num:chunk_num + chunk_size]
            print(f"  Processing chunk {chunk_num // chunk_size + 1} ({len(chunk)} rows)...")
            
            for index, row in chunk.iterrows():
                try:
                    lat = float(row[lat_col])
                    lon = float(row[lon_col])

                    if math.isnan(lat) or math.isnan(lon):
                        raise ValueError("Invalid coordinates")
                    
                    cust_id = str(row[id_col]) if id_col and pd.notna(row[id_col]) else f"CUST_{processed_count + 1}"
                    uploaded_branch_code = None
                    existing_branch_id = None
                    distance_customer_to_existing_branch = None

                    if branch_col and pd.notna(row[branch_col]):
                        branch_code = str(row[branch_col]).strip()
                        if branch_code:
                            uploaded_branch_code = branch_code
                            existing_branch = branch_lookup.get(branch_code.upper())
                            if existing_branch:
                                existing_branch_id = existing_branch['id']
                                distance_customer_to_existing_branch = haversine_distance(
                                    lat, lon,
                                    existing_branch['lat'], existing_branch['lon']
                                )
                    
                    # --- ORIGINAL BACKUP ---
                    # [IST 2026-03-09] Disabled current pocket logic block:
                    # 1) Pocket ID generation
                    # 2) Pocket -> branch mapping
                    # 3) Pocket -> customer mapping
                    # # Identify containing pocket at 5km level.
                    # nearest_pocket = find_nearest_pocket(lat, lon, config)
                    # pocket_id = nearest_pocket['pocketId']
                    #
                    # # Store result
                    # result_row = row.to_dict()
                    # result_row.update({
                    #     'PocketID': pocket_id,
                    #     'Distance to Pocket Center (m)': round(nearest_pocket['distance']),
                    #     'Pocket Center Lat': round(nearest_pocket['centerLat'], 6),
                    #     'Pocket Center Lon': round(nearest_pocket['centerLon'], 6)
                    # })
                    # all_results.append(result_row)
                    #
                    # # Track pocket stats
                    # pocket_stats[pocket_id] = pocket_stats.get(pocket_id, 0) + 1
                    #
                    # # Cache pocket center
                    # if pocket_id not in pocket_centers:
                    #     pocket_centers[pocket_id] = {
                    #         'lat': nearest_pocket['centerLat'],
                    #         'lon': nearest_pocket['centerLon']
                    #     }
                    #
                    # # Cache nearest branch for this pocket (fallback assignment).
                    # if pocket_id not in pocket_centers or 'nearestBranch' not in pocket_centers[pocket_id]:
                    #     branch_info = find_nearest_branch_for_pocket(
                    #         nearest_pocket['centerLat'],
                    #         nearest_pocket['centerLon'],
                    #         branches
                    #     )
                    #     if branch_info:
                    #         pocket_centers[pocket_id]['nearestBranch'] = branch_info
                    #
                    # selected_branch_info = pocket_centers[pocket_id].get('nearestBranch')
                    # # Revised mapping distance is pocket-center to branch distance.
                    # if selected_branch_info:
                    #     distance_customer_to_branch = selected_branch_info['distance']
                    #
                    #     # Store mapping
                    #     all_mappings.append({
                    #         # Must store UUID job_id (FK references jobs.job_id, not jobs.id)
                    #         'job_id': job_id,
                    #         'customer_id': cust_id,
                    #         'customer_lat': lat,
                    #         'customer_lon': lon,
                    #         'pocket_id': pocket_id,
                    #         'distance_customer_to_pocket': nearest_pocket['distance'],
                    #         'nearest_branch_id': selected_branch_info['branchId'],
                    #         'distance_pocket_to_branch': selected_branch_info['distance'],
                    #         'distance_customer_to_branch': distance_customer_to_branch,
                    #         'uploaded_branch_code': uploaded_branch_code,
                    #         'existing_branch_id': existing_branch_id,
                    #         'distance_customer_to_existing_branch': distance_customer_to_existing_branch
                    #     })
                    nearest_pocket, used_fallback = resolve_nearest_pocket(
                        lat,
                        lon,
                        config,
                        pocket_level_size=5000
                    )
                    if used_fallback:
                        fallback_pocket_config_hits += 1
                    pocket_id = nearest_pocket['pocketId']

                    result_row = row.to_dict()
                    result_row.update({
                        'PocketID': pocket_id,
                        'Distance to Pocket Center (m)': round(nearest_pocket['distance']),
                        'Pocket Center Lat': round(nearest_pocket['centerLat'], 6),
                        'Pocket Center Lon': round(nearest_pocket['centerLon'], 6)
                    })
                    all_results.append(result_row)

                    pocket_stats[pocket_id] = pocket_stats.get(pocket_id, 0) + 1

                    if pocket_id not in pocket_centers:
                        pocket_centers[pocket_id] = {
                            'lat': nearest_pocket['centerLat'],
                            'lon': nearest_pocket['centerLon']
                        }

                    if 'nearestBranch' not in pocket_centers[pocket_id]:
                        branch_info = find_nearest_branch_from_pocket_catalog(
                            nearest_pocket['centerLat'],
                            nearest_pocket['centerLon'],
                            branch_pocket_catalog
                        )
                        if branch_info:
                            pocket_centers[pocket_id]['nearestBranch'] = branch_info

                    selected_branch_info = pocket_centers[pocket_id].get('nearestBranch')
                    if selected_branch_info:
                        distance_customer_to_branch = selected_branch_info['distance']

                        all_mappings.append({
                            # Must store UUID job_id (FK references jobs.job_id, not jobs.id)
                            'job_id': job_id,
                            'customer_id': cust_id,
                            'customer_lat': lat,
                            'customer_lon': lon,
                            'pocket_id': pocket_id,
                            'distance_customer_to_pocket': nearest_pocket['distance'],
                            'nearest_branch_id': selected_branch_info['branchId'],
                            'distance_pocket_to_branch': selected_branch_info['distance'],
                            'distance_customer_to_branch': distance_customer_to_branch,
                            'uploaded_branch_code': uploaded_branch_code,
                            'existing_branch_id': existing_branch_id,
                            'distance_customer_to_existing_branch': distance_customer_to_existing_branch
                        })
                
                except Exception as e:
                    print(f"  ⚠️  Row {processed_count + 1} error: {e}")
                    result_row = row.to_dict()
                    result_row.update({
                        'PocketID': 'ERROR',
                        'Distance to Pocket Center (m)': 'N/A',
                        'Pocket Center Lat': 'N/A',
                        'Pocket Center Lon': 'N/A'
                    })
                    all_results.append(result_row)
                
                processed_count += 1
                
                # Update progress every 100 rows
                if processed_count % 100 == 0:
                    progress = int((processed_count / total_rows) * 100)
                    with db_engine.connect() as conn:
                        conn.execute(
                            text("UPDATE jobs SET progress = :prog WHERE job_id = :jid"),
                            {"prog": progress, "jid": job_id}
                        )
                        conn.commit()
        
        print(f"📊 Generating Excel output...")
        
        # Generate output Excel
        output_filename = f"result_{job_id}.xlsx"
        output_path = os.path.join(UPLOAD_DIR, output_filename)
        
        with pd.ExcelWriter(output_path, engine='openpyxl') as writer:
            # Results sheet
            results_df = pd.DataFrame(all_results)
            results_df.to_excel(writer, sheet_name='Results', index=False)
            
            # Statistics sheet
            stats_data = [
                {'Pocket ID': pid, 'Account Count': count}
                for pid, count in sorted(pocket_stats.items(), key=lambda x: x[1], reverse=True)
            ]
            stats_df = pd.DataFrame(stats_data)
            stats_df.to_excel(writer, sheet_name='Statistics', index=False)
        
        print(f"💾 Saving {len(all_mappings)} mappings to database...")
        
        # --- ORIGINAL BACKUP ---
        # [IST 2026-03-09] Disabled current mapping persistence block:
        # 1) Pocket -> customer persistence
        # 2) Implicit pocket -> branch persistence through nearest_branch_id writes
        # # Bulk insert mappings in small batches to avoid PostgreSQL parameter limit
        # replaced_mappings_count = 0
        # if all_mappings:
        #     if replace_existing:
        #         with db_engine.connect() as conn:
        #             delete_result = conn.execute(text("DELETE FROM customer_pocket_mappings"))
        #             conn.commit()
        #             replaced_mappings_count = delete_result.rowcount if delete_result.rowcount is not None else 0
        #     batch_size = 100
        #     for i in range(0, len(all_mappings), batch_size):
        #         batch = all_mappings[i:i + batch_size]
        #         mappings_df = pd.DataFrame(batch)
        #         mappings_df.to_sql(
        #             'customer_pocket_mappings',
        #             db_engine,
        #             if_exists='append',
        #             index=False
        #         )
        #         if (i + batch_size) % 1000 == 0:
        #             print(f"  Saved {min(i + batch_size, len(all_mappings))}/{len(all_mappings)} mappings...")
        replaced_mappings_count = 0
        if all_mappings:
            if replace_existing:
                with db_engine.connect() as conn:
                    delete_result = conn.execute(text("DELETE FROM customer_pocket_mappings"))
                    conn.commit()
                    replaced_mappings_count = delete_result.rowcount if delete_result.rowcount is not None else 0
            batch_size = 100
            for i in range(0, len(all_mappings), batch_size):
                batch = all_mappings[i:i + batch_size]
                mappings_df = pd.DataFrame(batch)
                mappings_df.to_sql(
                    'customer_pocket_mappings',
                    db_engine,
                    if_exists='append',
                    index=False
                )
                if (i + batch_size) % 1000 == 0:
                    print(f"  Saved {min(i + batch_size, len(all_mappings))}/{len(all_mappings)} mappings...")
        
        # Finalize job
        stats = {
            "fileName": job_data['fileName'],
            "pocketStats": pocket_stats,
            "totalPockets": len(pocket_stats),
            "totalAccounts": processed_count,
            "mappingsPersisted": len(all_mappings),
            "fallbackPocketConfigHits": int(fallback_pocket_config_hits),
            "branchPocketFallbackHits": int(branch_pocket_fallback_hits),
            "replaceExisting": bool(replace_existing),
            "replacedMappingsCount": int(replaced_mappings_count),
            "territoryUrl": f"/api/v1/batch/territories/{job_id}",
            "worker": "python"
        }
        
        with db_engine.connect() as conn:
            conn.execute(
                text("""
                    UPDATE jobs 
                    SET status = 'completed', 
                        progress = 100, 
                        completed_at = CURRENT_TIMESTAMP,
                        result_url = :url,
                        data = :data
                    WHERE job_id = :job_id
                """),
                {
                    "url": f"/api/v1/batch/download/{job_id}",
                    "data": json.dumps(stats),
                    "job_id": job_id
                }
            )
            conn.commit()
        
        print(f"✅ Job {job_id} completed successfully")
        print(f"   Processed: {processed_count} rows")
        print(f"   Unique pockets: {len(pocket_stats)}")
        print(f"   Mappings saved: {len(all_mappings)}")
        print(f"   Pocket fallback hits: {fallback_pocket_config_hits}")
        print(f"   Branch pocket fallback hits: {branch_pocket_fallback_hits}")

        return {
            'jobId': job_id,
            'total': processed_count,
            'pocketStats': pocket_stats,
            'mappingsPersisted': len(all_mappings),
            'fallbackPocketConfigHits': int(fallback_pocket_config_hits),
            'branchPocketFallbackHits': int(branch_pocket_fallback_hits),
            'replacedMappingsCount': int(replaced_mappings_count),
            'buffer': None  # File saved to disk
        }
    
    except Exception as e:
        print(f"❌ Job {job_id} failed: {str(e)}")
        import traceback
        traceback.print_exc()
        
        with db_engine.connect() as conn:
            conn.execute(
                text("UPDATE jobs SET status = 'failed', error = :err WHERE job_id = :job_id"),
                {"err": str(e), "job_id": job_id}
            )
            conn.commit()
        
        raise

def main():
    """Main worker loop"""
    print("=" * 60)
    print("🚀 Python Batch Processing Worker")
    print("=" * 60)
    print(f"📡 Listening on Redis list: python_batch_jobs")
    print(f"🔌 Redis: {REDIS_URL}")
    print(f"🔌 Database: {DB_URL.split('@')[1]}")
    print(f"📁 Upload directory: {UPLOAD_DIR}")
    print("=" * 60)
    print()
    
    while True:
        try:
            print("⏳ Waiting for jobs...")
            # Listen to raw Redis list (not Bull's complex structure)
            _, message = redis_client.brpop('python_batch_jobs', timeout=0)
            
            if message:
                # Parse the raw JSON payload
                job_payload = json.loads(message.decode('utf-8'))
                
                print(f"\n📥 Received job: {job_payload['jobId']}")
                process_job(job_payload)
                print()
            
        except KeyboardInterrupt:
            print("\n\n👋 Shutting down worker...")
            break
        except Exception as e:
            print(f"❌ Queue error: {str(e)}")
            import traceback
            traceback.print_exc()
            print()

if __name__ == '__main__':
    main()

