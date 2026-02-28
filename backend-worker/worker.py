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
DB_URL = os.getenv('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5434/pockets')
UPLOAD_DIR = os.getenv('UPLOAD_DIR', '../backend/uploads')

# Grid configuration
METERS_PER_DEGREE_LAT = 111000
GRID_LEVELS = [500000, 100000, 20000, 5000, 1000]

# Initialize connections
print(f"🔌 Connecting to Redis: {REDIS_URL}")
redis_client = redis.from_url(REDIS_URL)

print(f"🔌 Connecting to PostgreSQL: {DB_URL.split('@')[1]}")  # Hide password
db_engine = create_engine(DB_URL, pool_pre_ping=True)

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

def find_nearest_pocket(customer_lat, customer_lon, config, search_radius=50000):
    """Find nearest pocket to customer coordinates"""
    x, y = lat_lon_to_meters(
        customer_lat, customer_lon,
        config['originLat'], config['originLon']
    )
    
    # Calculate starting pocket
    start_indices = calculate_indices(x, y)
    start_pocket_id = encode_indices(start_indices, config['alphabet'])
    
    # Get center of starting pocket
    center_lat, center_lon = decode_pocket_id(start_pocket_id, config)
    
    nearest_pocket_id = start_pocket_id
    nearest_distance = haversine_distance(customer_lat, customer_lon, center_lat, center_lon)
    nearest_center = (center_lat, center_lon)
    
    # Check surrounding pockets
    finest_level_size = GRID_LEVELS[-1]
    pockets_to_check = math.ceil(search_radius / finest_level_size)
    
    for row_offset in range(-pockets_to_check, pockets_to_check + 1):
        for col_offset in range(-pockets_to_check, pockets_to_check + 1):
            offset_distance = math.sqrt(row_offset**2 + col_offset**2) * finest_level_size
            if offset_distance > search_radius:
                continue
            
            test_indices = start_indices.copy()
            test_indices[-1] = {
                **test_indices[-1],
                'row': test_indices[-1]['row'] + row_offset,
                'col': test_indices[-1]['col'] + col_offset
            }
            
            try:
                test_pocket_id = encode_indices(test_indices, config['alphabet'])
                test_center_lat, test_center_lon = decode_pocket_id(test_pocket_id, config)
                
                distance = haversine_distance(
                    customer_lat, customer_lon,
                    test_center_lat, test_center_lon
                )
                
                if distance < nearest_distance:
                    nearest_distance = distance
                    nearest_pocket_id = test_pocket_id
                    nearest_center = (test_center_lat, test_center_lon)
            except:
                continue
    
    return {
        'pocketId': nearest_pocket_id,
        'distance': nearest_distance,
        'centerLat': nearest_center[0],
        'centerLon': nearest_center[1]
    }

def get_job_db_id(job_uuid):
    """Map UUID to PostgreSQL internal ID"""
    with db_engine.connect() as conn:
        result = conn.execute(
            text("SELECT id FROM jobs WHERE job_id = :job_id"),
            {"job_id": job_uuid}
        )
        row = result.fetchone()
        return row[0] if row else None

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

def process_job(job_data):
    """Process a batch job"""
    job_id = job_data['jobId']
    file_path = job_data['filePath']
    config = job_data['config']
    
    print(f"🔄 Starting job {job_id} for {file_path}")
    
    # Update job to active
    with db_engine.connect() as conn:
        conn.execute(
            text("UPDATE jobs SET status = 'active' WHERE job_id = :job_id"),
            {"job_id": job_id}
        )
        conn.commit()
    
    try:
        # Count total rows
        print(f"📊 Counting rows...")
        total_rows = pd.read_excel(file_path, engine='openpyxl', nrows=0).shape[0]
        total_rows = len(pd.read_excel(file_path, engine='openpyxl'))
        
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
        
        processed_count = 0
        all_results = []
        all_mappings = []
        pocket_stats = {}
        pocket_centers = {}
        
        # Process in chunks
        chunk_size = 5000
        excel_reader = pd.read_excel(file_path, engine='openpyxl', chunksize=chunk_size)
        job_db_id = get_job_db_id(job_id)
        
        for chunk_num, chunk in enumerate(excel_reader):
            print(f"  Processing chunk {chunk_num + 1} ({len(chunk)} rows)...")
            
            # Standardize column names
            chunk.columns = [col.lower() for col in chunk.columns]
            
            # Find coordinate columns
            lat_col = next((c for c in ['canon_lat', 'latitude', 'lat'] if c in chunk.columns), None)
            lon_col = next((c for c in ['canon_long', 'longitude', 'lon'] if c in chunk.columns), None)
            id_col = next((c for c in ['lan', 'customerid', 'customer_id', 'id'] if c in chunk.columns), None)
            
            if not lat_col or not lon_col:
                raise ValueError("Could not find latitude/longitude columns")
            
            for index, row in chunk.iterrows():
                try:
                    lat = float(row[lat_col])
                    lon = float(row[lon_col])
                    
                    if math.isnan(lat) or math.isnan(lon):
                        raise ValueError("Invalid coordinates")
                    
                    cust_id = str(row[id_col]) if id_col and pd.notna(row[id_col]) else f"CUST_{processed_count + 1}"
                    
                    # Find nearest pocket
                    nearest_pocket = find_nearest_pocket(lat, lon, config)
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
                    
                    # Find nearest branch for this pocket
                    if pocket_id not in pocket_centers or 'branch' not in pocket_centers[pocket_id]:
                        branch_info = find_nearest_branch_for_pocket(
                            nearest_pocket['centerLat'],
                            nearest_pocket['centerLon'],
                            branches
                        )
                        if branch_info:
                            pocket_centers[pocket_id]['branch'] = branch_info
                    
                    # Calculate customer to branch distance
                    branch_info = pocket_centers[pocket_id].get('branch')
                    if branch_info:
                        distance_customer_to_branch = haversine_distance(
                            lat, lon,
                            branch_info['branchLat'], branch_info['branchLon']
                        )
                        
                        # Store mapping
                        all_mappings.append({
                            'job_id': job_db_id,
                            'customer_id': cust_id,
                            'customer_lat': lat,
                            'customer_lon': lon,
                            'pocket_id': pocket_id,
                            'distance_customer_to_pocket': nearest_pocket['distance'],
                            'nearest_branch_id': branch_info['branchId'],
                            'distance_pocket_to_branch': branch_info['distance'],
                            'distance_customer_to_branch': distance_customer_to_branch
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
        
        # Bulk insert mappings
        if all_mappings:
            mappings_df = pd.DataFrame(all_mappings)
            mappings_df.to_sql(
                'customer_pocket_mappings',
                db_engine,
                if_exists='append',
                index=False,
                method='multi',
                chunksize=1000
            )
        
        # Finalize job
        stats = {
            "fileName": job_data['fileName'],
            "pocketStats": pocket_stats,
            "totalPockets": len(pocket_stats),
            "totalAccounts": processed_count,
            "mappingsPersisted": len(all_mappings)
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
        
        return {
            'jobId': job_id,
            'total': processed_count,
            'pocketStats': pocket_stats,
            'mappingsPersisted': len(all_mappings),
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
