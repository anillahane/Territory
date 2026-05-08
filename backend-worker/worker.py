#!/usr/bin/env python3
"""
Python Worker for Batch Processing
Handles large file processing (5000+ rows) with memory-efficient chunking
"""

import redis
import json
import os
import ntpath
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
DEFAULT_POCKET_CONFIG_ORIGIN_LAT = 8.0
DEFAULT_POCKET_CONFIG_ORIGIN_LON = 68.0
DEFAULT_POCKET_CONFIG_ALPHABET = '0123456789ABCDEFGHJKLMNPQRSTUV'
MAX_POCKET_CENTER_DISTANCE_TOLERANCE_METERS = 250

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
    def resolve_alphabet_index(value):
        numeric_value = int(value)
        if numeric_value < 0 or numeric_value >= len(alphabet):
            raise ValueError(
                f"Grid index {numeric_value} is outside supported Pocket ID bounds (0-{len(alphabet) - 1})"
            )
        return numeric_value

    parts = []
    for idx in indices:
        row_char = alphabet[resolve_alphabet_index(idx['row'])]
        col_char = alphabet[resolve_alphabet_index(idx['col'])]
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

def sanitize_pocket_config(raw_config):
    """Normalize pocket config with safe defaults."""
    if not isinstance(raw_config, dict):
        raw_config = {}

    origin_lat = raw_config.get('originLat')
    origin_lon = raw_config.get('originLon')
    alphabet = str(raw_config.get('alphabet') or '').strip()

    try:
        parsed_origin_lat = float(origin_lat)
    except (TypeError, ValueError):
        parsed_origin_lat = DEFAULT_POCKET_CONFIG_ORIGIN_LAT

    try:
        parsed_origin_lon = float(origin_lon)
    except (TypeError, ValueError):
        parsed_origin_lon = DEFAULT_POCKET_CONFIG_ORIGIN_LON

    return {
        'originLat': parsed_origin_lat if math.isfinite(parsed_origin_lat) else DEFAULT_POCKET_CONFIG_ORIGIN_LAT,
        'originLon': parsed_origin_lon if math.isfinite(parsed_origin_lon) else DEFAULT_POCKET_CONFIG_ORIGIN_LON,
        'alphabet': alphabet if len(alphabet) == 30 else DEFAULT_POCKET_CONFIG_ALPHABET
    }

def is_valid_nearest_pocket_candidate(nearest_pocket, pocket_level_size=5000):
    """Validate nearest pocket output for geographical sanity and expected bounds."""
    if not isinstance(nearest_pocket, dict):
        return False

    pocket_id = str(nearest_pocket.get('pocketId') or '').strip()
    distance = nearest_pocket.get('distance')
    center_lat = nearest_pocket.get('centerLat')
    center_lon = nearest_pocket.get('centerLon')

    try:
        distance = float(distance)
        center_lat = float(center_lat)
        center_lon = float(center_lon)
    except (TypeError, ValueError):
        return False

    max_expected_distance = ((float(pocket_level_size) * math.sqrt(2)) / 2) + MAX_POCKET_CENTER_DISTANCE_TOLERANCE_METERS

    return (
        pocket_id != ''
        and math.isfinite(distance)
        and distance >= 0
        and distance <= max_expected_distance
        and math.isfinite(center_lat)
        and math.isfinite(center_lon)
        and -90 <= center_lat <= 90
        and -180 <= center_lon <= 180
    )

def resolve_nearest_pocket_assignment(customer_lat, customer_lon, raw_config, pocket_level_size=5000):
    """Find nearest pocket with fallback origin when config drifts into invalid decode space."""
    primary_config = sanitize_pocket_config(raw_config)
    fallback_config = {
        'originLat': DEFAULT_POCKET_CONFIG_ORIGIN_LAT,
        'originLon': DEFAULT_POCKET_CONFIG_ORIGIN_LON,
        'alphabet': primary_config['alphabet'] or DEFAULT_POCKET_CONFIG_ALPHABET
    }

    def attempt(candidate_config, used_fallback_config):
        nearest = find_nearest_pocket(
            customer_lat,
            customer_lon,
            candidate_config,
            pocket_level_size=pocket_level_size
        )
        if not is_valid_nearest_pocket_candidate(nearest, pocket_level_size):
            raise ValueError('Invalid nearest pocket candidate generated from pocket config')
        return {
            'nearestPocket': nearest,
            'usedFallbackConfig': used_fallback_config
        }

    try:
        return attempt(primary_config, False)
    except Exception as primary_error:
        should_try_fallback = (
            primary_config['originLat'] != fallback_config['originLat']
            or primary_config['originLon'] != fallback_config['originLon']
        )
        if not should_try_fallback:
            raise primary_error

        return attempt(fallback_config, True)

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

def delete_existing_mappings(conn, job_id, wipe_all, replace_scope_branch_ids):
    """Delete existing mappings using scoped semantics unless an explicit global wipe is requested."""
    if wipe_all:
        result = conn.execute(text("DELETE FROM customer_pocket_mappings"))
        print(f"⚠️ Global mapping wipe requested for job {job_id}: deleted {result.rowcount or 0} rows")
        return int(result.rowcount or 0)

    branch_ids = [
        str(branch_id).strip()
        for branch_id in (replace_scope_branch_ids or [])
        if str(branch_id).strip()
    ]
    if not branch_ids:
        raise ValueError("replaceExisting requires scoped branch IDs when confirmWipeAll is false")

    result = conn.execute(
        text("""
            DELETE FROM customer_pocket_mappings
            WHERE existing_branch_id = ANY(:branch_ids)
               OR nearest_branch_id = ANY(:branch_ids)
        """),
        {"branch_ids": branch_ids}
    )
    return int(result.rowcount or 0)

def record_job_errors(conn, job_id, batch_number, mappings_batch, error_message):
    """Persist failed batch rows without aborting the whole job."""
    if not mappings_batch:
        return

    payload_rows = []
    for mapping in mappings_batch:
        payload_rows.append({
            "job_id": job_id,
            "customer_id": mapping.get("customer_id"),
            "batch_number": batch_number,
            "error_message": error_message,
            "payload": json.dumps(mapping)
        })

    conn.execute(
        text("""
            INSERT INTO job_errors (job_id, customer_id, batch_number, error_message, payload)
            VALUES (:job_id, :customer_id, :batch_number, :error_message, CAST(:payload AS jsonb))
        """),
        payload_rows
    )

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

def process_job(job_data):
    """Process a batch job"""
    job_id = job_data['jobId']
    file_path = job_data['filePath']
    config = job_data['config']
    replace_existing = parse_bool_flag(job_data.get('replaceExisting', False), False)
    confirm_wipe_all = parse_bool_flag(job_data.get('confirmWipeAll', False), False)
    replace_scope_branch_ids = [
        str(branch_id).strip()
        for branch_id in (job_data.get('replaceScopeBranchIds') or [])
        if str(branch_id).strip()
    ]

    # --- ORIGINAL BACKUP ---
    # Normalize file path to avoid cwd-dependent failures from manually requeued jobs.
    # if not os.path.isabs(file_path):
    #     file_path = os.path.abspath(file_path)
    # if not os.path.exists(file_path):
    #     fallback_path = os.path.join(UPLOAD_DIR, os.path.basename(file_path))
    #     if os.path.exists(fallback_path):
    #         file_path = fallback_path

    # Resolve mixed Windows/Linux path payloads robustly.
    original_file_path = job_data.get('originalFilePath')
    raw_candidates = [file_path, original_file_path]
    resolved_file_path = None
    checked_candidates = []

    def add_candidate(candidate_value):
        if not candidate_value:
            return
        candidate = str(candidate_value).strip()
        if not candidate:
            return
        if candidate in checked_candidates:
            return
        checked_candidates.append(candidate)

    for candidate in raw_candidates:
        add_candidate(candidate)

        if candidate:
            candidate_text = str(candidate).strip()
            if candidate_text and '\\' in candidate_text:
                add_candidate(candidate_text.replace('\\', '/'))

            base_posix = os.path.basename(candidate_text) if candidate_text else ''
            base_windows = ntpath.basename(candidate_text) if candidate_text else ''
            add_candidate(base_posix)
            add_candidate(base_windows)

            if base_posix:
                add_candidate(os.path.join(UPLOAD_DIR, base_posix))
            if base_windows:
                add_candidate(os.path.join(UPLOAD_DIR, base_windows))

    for candidate in checked_candidates:
        if not candidate:
            continue

        normalized_candidate = candidate
        if not os.path.isabs(normalized_candidate):
            normalized_candidate = os.path.abspath(normalized_candidate)

        if os.path.exists(normalized_candidate):
            resolved_file_path = normalized_candidate
            break

        upload_candidate = os.path.join(UPLOAD_DIR, ntpath.basename(candidate))
        if os.path.exists(upload_candidate):
            resolved_file_path = upload_candidate
            break

    if not resolved_file_path:
        raise FileNotFoundError(
            f"Input file not found for job {job_id}. Checked candidates: {checked_candidates}"
        )

    file_path = resolved_file_path
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
        
        processed_count = 0
        all_results = []
        all_mappings = []
        pocket_stats = {}
        pocket_centers = {}
        fallback_pocket_config_hits = 0
        
        # Process in chunks (split dataframe into chunks)
        chunk_size = 5000
        # Standardize column names
        df.columns = [col.lower() for col in df.columns]
        
        # Find coordinate columns
        lat_col = next((c for c in ['canon_lat', 'latitude', 'lat'] if c in df.columns), None)
        lon_col = next((c for c in ['canon_long', 'longitude', 'lon'] if c in df.columns), None)
        id_col = next((c for c in ['lan', 'customerid', 'customer_id', 'id'] if c in df.columns), None)
        branch_col = next((c for c in ['branch_code', 'branchcode', 'branch code'] if c in df.columns), None)
        bucket_col = next((
            c for c in [
                'customer_bucket',
                'customerbucket',
                'bucket',
                'customer_tag',
                'customertag',
                'tag'
            ] if c in df.columns
        ), None)
        
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
                    customer_bucket = None

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

                    if bucket_col and pd.notna(row[bucket_col]):
                        parsed_bucket = str(row[bucket_col]).strip()
                        if parsed_bucket:
                            customer_bucket = parsed_bucket
                    
                    # --- ORIGINAL BACKUP ---
                    # # Identify containing pocket at 5km level.
                    # nearest_pocket = find_nearest_pocket(lat, lon, config)
                    pocket_assignment = resolve_nearest_pocket_assignment(lat, lon, config, pocket_level_size=5000)
                    nearest_pocket = pocket_assignment['nearestPocket']
                    if pocket_assignment['usedFallbackConfig']:
                        fallback_pocket_config_hits += 1
                    pocket_id = nearest_pocket['pocketId']
                    
                    # Store result
                    result_row = row.to_dict()
                    result_row.update({
                        'PocketID': pocket_id,
                        'Distance to Pocket Center (m)': round(nearest_pocket['distance']),
                        'Pocket Center Lat': round(nearest_pocket['centerLat'], 6),
                        'Pocket Center Lon': round(nearest_pocket['centerLon'], 6)
                    })
                    all_results.append(result_row)
                    
                    # Track pocket stats
                    pocket_stats[pocket_id] = pocket_stats.get(pocket_id, 0) + 1
                    
                    # Cache pocket center
                    if pocket_id not in pocket_centers:
                        pocket_centers[pocket_id] = {
                            'lat': nearest_pocket['centerLat'],
                            'lon': nearest_pocket['centerLon']
                        }
                    
                    # Cache nearest branch for this pocket (fallback assignment).
                    if pocket_id not in pocket_centers or 'nearestBranch' not in pocket_centers[pocket_id]:
                        branch_info = find_nearest_branch_for_pocket(
                            nearest_pocket['centerLat'],
                            nearest_pocket['centerLon'],
                            branches
                        )
                        if branch_info:
                            pocket_centers[pocket_id]['nearestBranch'] = branch_info

                    selected_branch_info = pocket_centers[pocket_id].get('nearestBranch')
                    if selected_branch_info:
                        distance_pocket_to_branch = selected_branch_info['distance']
                        distance_customer_to_branch = haversine_distance(
                            lat,
                            lon,
                            selected_branch_info['branchLat'],
                            selected_branch_info['branchLon']
                        )
                        if not math.isfinite(distance_pocket_to_branch) or not math.isfinite(distance_customer_to_branch):
                            raise ValueError("Invalid branch distance resolved for mapped customer")
                        
                        # Store mapping
                        all_mappings.append({
                            # Must store UUID job_id (FK references jobs.job_id, not jobs.id)
                            'job_id': job_id,
                            'customer_id': cust_id,
                            'customer_lat': lat,
                            'customer_lon': lon,
                            'pocket_id': pocket_id,
                            'distance_customer_to_pocket': nearest_pocket['distance'],
                            'nearest_branch_id': selected_branch_info['branchId'],
                            'distance_pocket_to_branch': distance_pocket_to_branch,
                            'distance_customer_to_branch': distance_customer_to_branch,
                            'uploaded_branch_code': uploaded_branch_code,
                            'existing_branch_id': existing_branch_id,
                            'distance_customer_to_existing_branch': distance_customer_to_existing_branch,
                            'customer_bucket': customer_bucket
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

        replaced_mappings_count = 0
        persisted_mappings_count = 0
        if all_mappings:
            batch_size = 1000
            insert_sql = text("""
                INSERT INTO customer_pocket_mappings (
                    job_id,
                    customer_id,
                    customer_lat,
                    customer_lon,
                    pocket_id,
                    distance_customer_to_pocket,
                    nearest_branch_id,
                    distance_pocket_to_branch,
                    distance_customer_to_branch,
                    uploaded_branch_code,
                    existing_branch_id,
                    distance_customer_to_existing_branch,
                    customer_bucket
                ) VALUES (
                    :job_id,
                    :customer_id,
                    :customer_lat,
                    :customer_lon,
                    :pocket_id,
                    :distance_customer_to_pocket,
                    :nearest_branch_id,
                    :distance_pocket_to_branch,
                    :distance_customer_to_branch,
                    :uploaded_branch_code,
                    :existing_branch_id,
                    :distance_customer_to_existing_branch,
                    :customer_bucket
                )
                ON CONFLICT (customer_id) DO UPDATE SET
                    job_id = EXCLUDED.job_id,
                    customer_lat = EXCLUDED.customer_lat,
                    customer_lon = EXCLUDED.customer_lon,
                    pocket_id = EXCLUDED.pocket_id,
                    distance_customer_to_pocket = EXCLUDED.distance_customer_to_pocket,
                    nearest_branch_id = EXCLUDED.nearest_branch_id,
                    distance_pocket_to_branch = EXCLUDED.distance_pocket_to_branch,
                    distance_customer_to_branch = EXCLUDED.distance_customer_to_branch,
                    uploaded_branch_code = EXCLUDED.uploaded_branch_code,
                    existing_branch_id = EXCLUDED.existing_branch_id,
                    distance_customer_to_existing_branch = EXCLUDED.distance_customer_to_existing_branch,
                    customer_bucket = EXCLUDED.customer_bucket,
                    updated_at = CURRENT_TIMESTAMP
            """)
            with db_engine.begin() as conn:
                if replace_existing:
                    replaced_mappings_count = delete_existing_mappings(
                        conn,
                        job_id,
                        confirm_wipe_all,
                        replace_scope_branch_ids
                    )

                for i in range(0, len(all_mappings), batch_size):
                    batch = all_mappings[i:i + batch_size]
                    batch_number = (i // batch_size) + 1
                    nested = conn.begin_nested()
                    try:
                        conn.execute(insert_sql, batch)
                        nested.commit()
                        persisted_mappings_count += len(batch)
                    except Exception as batch_error:
                        nested.rollback()
                        record_job_errors(conn, job_id, batch_number, batch, str(batch_error))
                        print(f"  Failed batch {batch_number}: {batch_error}")
                    if (i + batch_size) % 1000 == 0 or (i + batch_size) >= len(all_mappings):
                        print(f"  Saved {min(i + batch_size, len(all_mappings))}/{len(all_mappings)} mappings...")
        
        # Finalize job
        stats = {
            "fileName": job_data['fileName'],
            "pocketStats": pocket_stats,
            "totalPockets": len(pocket_stats),
            "totalAccounts": processed_count,
            "mappingsPersisted": persisted_mappings_count,
            "replaceExisting": bool(replace_existing),
            "confirmWipeAll": bool(confirm_wipe_all),
            "replaceScopeBranchIds": replace_scope_branch_ids,
            "replacedMappingsCount": int(replaced_mappings_count),
            "fallbackPocketConfigHits": int(fallback_pocket_config_hits),
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
        print(f"   Mappings saved: {persisted_mappings_count}")
        
        return {
            'jobId': job_id,
            'total': processed_count,
            'pocketStats': pocket_stats,
            'mappingsPersisted': persisted_mappings_count,
            'replacedMappingsCount': int(replaced_mappings_count),
            'fallbackPocketConfigHits': int(fallback_pocket_config_hits),
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
