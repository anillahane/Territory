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

try:
    import sentry_sdk
except ImportError:
    sentry_sdk = None

try:
    from opentelemetry import trace
    from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
    from opentelemetry.instrumentation.redis import RedisInstrumentor
    from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor
    from opentelemetry.sdk.resources import Resource
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor
except ImportError:
    trace = None
    OTLPSpanExporter = None
    RedisInstrumentor = None
    SQLAlchemyInstrumentor = None
    Resource = None
    TracerProvider = None
    BatchSpanProcessor = None

# Configuration
REDIS_URL = os.getenv('REDIS_URL', 'redis://127.0.0.1:6379')
DB_URL = os.getenv('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5434/location_pockets')
UPLOAD_DIR = os.getenv('UPLOAD_DIR', '../backend/uploads')

# Grid configuration
METERS_PER_DEGREE_LAT = 111000
GRID_LEVELS = [500000, 100000, 20000, 5000, 1000]
PERSIST_BATCH_SIZE = 1000
MAPPING_COLUMNS = (
    'job_id',
    'customer_id',
    'customer_lat',
    'customer_lon',
    'pocket_id',
    'distance_customer_to_pocket',
    'nearest_branch_id',
    'distance_pocket_to_branch',
    'distance_customer_to_branch',
    'uploaded_branch_code',
    'existing_branch_id',
    'distance_customer_to_existing_branch',
)
UPSERT_UPDATE_COLUMNS = tuple(
    column for column in MAPPING_COLUMNS if column != 'customer_id'
)

def parse_float_env(name, default):
    """Parse floating-point env vars with a fallback."""
    raw_value = os.getenv(name)
    if raw_value is None:
        return default

    try:
        return float(raw_value)
    except (TypeError, ValueError):
        return default

def parse_otlp_headers(raw_value):
    """Parse OTLP exporter headers from OTEL_EXPORTER_OTLP_HEADERS."""
    if not raw_value:
        return None

    headers = {}
    for entry in raw_value.split(','):
        entry = entry.strip()
        if not entry or '=' not in entry:
            continue

        key, value = entry.split('=', 1)
        key = key.strip()
        value = value.strip()
        if key and value:
            headers[key] = value

    return headers or None

def resolve_otlp_traces_endpoint():
    """Resolve the OTLP traces endpoint using standard env vars."""
    explicit_endpoint = os.getenv('OTEL_EXPORTER_OTLP_TRACES_ENDPOINT')
    if explicit_endpoint:
        return explicit_endpoint

    base_endpoint = os.getenv('OTEL_EXPORTER_OTLP_ENDPOINT')
    if not base_endpoint:
        return None

    normalized_base = base_endpoint.rstrip('/')
    if normalized_base.endswith('/v1/traces'):
        return normalized_base

    return f"{normalized_base}/v1/traces"

def init_sentry():
    """Initialize Sentry error reporting when a DSN is available."""
    if sentry_sdk is None:
        return False

    sentry_dsn = os.getenv('SENTRY_DSN')
    if not sentry_dsn:
        return False

    sentry_sdk.init(
        dsn=sentry_dsn,
        environment=os.getenv('SENTRY_ENVIRONMENT') or os.getenv('NODE_ENV') or 'development',
        release=os.getenv('SENTRY_RELEASE'),
        sample_rate=parse_float_env('SENTRY_SAMPLE_RATE', 1.0),
        traces_sample_rate=parse_float_env('SENTRY_TRACES_SAMPLE_RATE', 0.0),
    )
    return True

def init_open_telemetry():
    """Initialize OTLP trace exporting for Redis and SQLAlchemy calls."""
    if (
        trace is None
        or OTLPSpanExporter is None
        or Resource is None
        or TracerProvider is None
        or BatchSpanProcessor is None
    ):
        return None

    otlp_endpoint = resolve_otlp_traces_endpoint()
    if not otlp_endpoint:
        return None

    provider = TracerProvider(
        resource=Resource.create({
            "service.name": os.getenv('OTEL_SERVICE_NAME', 'territory-batch-worker'),
        })
    )
    provider.add_span_processor(
        BatchSpanProcessor(
            OTLPSpanExporter(
                endpoint=otlp_endpoint,
                headers=parse_otlp_headers(os.getenv('OTEL_EXPORTER_OTLP_HEADERS')),
            )
        )
    )
    trace.set_tracer_provider(provider)

    if RedisInstrumentor is not None:
        RedisInstrumentor().instrument()

    return provider

SENTRY_ENABLED = init_sentry()
TRACER_PROVIDER = init_open_telemetry()
TRACER = trace.get_tracer("territory.backend_worker") if trace is not None else None

# Initialize connections
print(f"🔌 Connecting to Redis: {REDIS_URL}")
redis_client = redis.from_url(REDIS_URL)

print(f"🔌 Connecting to PostgreSQL: {DB_URL.split('@')[1]}")  # Hide password
db_engine = create_engine(DB_URL, pool_pre_ping=True)

if SQLAlchemyInstrumentor is not None:
    SQLAlchemyInstrumentor().instrument(engine=db_engine)

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

def dedupe_mappings_batch(batch):
    """Collapse duplicate customer IDs within a single upsert batch."""
    deduped = {}
    for mapping in batch:
        deduped[str(mapping['customer_id'])] = mapping
    return list(deduped.values())

def build_mapping_upsert_statement(batch):
    """Build a parameterized batch upsert statement for customer mappings."""
    params = {}
    values_sql = []

    for index, mapping in enumerate(batch):
        row_placeholders = []
        for column in MAPPING_COLUMNS:
            parameter_name = f"{column}_{index}"
            row_placeholders.append(f":{parameter_name}")
            params[parameter_name] = mapping.get(column)
        values_sql.append(f"({', '.join(row_placeholders)})")

    update_assignments = ',\n            '.join(
        [f"{column} = EXCLUDED.{column}" for column in UPSERT_UPDATE_COLUMNS] +
        ['created_at = CURRENT_TIMESTAMP']
    )

    statement = text(f"""
        INSERT INTO customer_pocket_mappings (
            {', '.join(MAPPING_COLUMNS)}
        )
        VALUES {', '.join(values_sql)}
        ON CONFLICT (customer_id) DO UPDATE SET
            {update_assignments}
    """)

    return statement, params

def collect_scoped_branch_ids(mappings):
    """Collect branch IDs referenced by the uploaded file."""
    return sorted({
        str(mapping.get('existing_branch_id') or '').strip()
        for mapping in mappings
        if str(mapping.get('existing_branch_id') or '').strip()
    })

def build_scoped_delete_statement(branch_ids):
    """Build a parameterized scoped delete for referenced branches."""
    params = {}
    placeholders = []

    for index, branch_id in enumerate(branch_ids):
        parameter_name = f"branch_id_{index}"
        params[parameter_name] = branch_id
        placeholders.append(f":{parameter_name}")

    statement = text(f"""
        DELETE FROM customer_pocket_mappings
        WHERE COALESCE(existing_branch_id, nearest_branch_id) IN ({', '.join(placeholders)})
    """)

    return statement, params

def resolve_replace_existing_scope(replace_existing, confirm_wipe_all, mappings):
    """Resolve whether a replacement upload is scoped or global."""
    if not replace_existing:
        return 'none', []

    if confirm_wipe_all:
        return 'global', []

    branch_ids = collect_scoped_branch_ids(mappings)
    if not branch_ids:
        raise ValueError(
            'replaceExisting requires at least one valid branch_code mapped to an existing branch, '
            'or confirmWipeAll=true for a global wipe'
        )

    return 'scoped', branch_ids

def persist_mappings_atomically(job_id, mappings, replace_existing=False, confirm_wipe_all=False):
    """Persist mappings in one transaction with per-batch savepoints."""
    total_batches = math.ceil(len(mappings) / PERSIST_BATCH_SIZE) if mappings else 0
    persisted_count = 0
    replaced_mappings_count = 0
    errors = []
    delete_mode, scoped_branch_ids = resolve_replace_existing_scope(
        replace_existing,
        confirm_wipe_all,
        mappings,
    )

    with db_engine.begin() as conn:
        if delete_mode == 'global':
            delete_result = conn.execute(text("DELETE FROM customer_pocket_mappings"))
            replaced_mappings_count = delete_result.rowcount if delete_result.rowcount is not None else 0
        elif delete_mode == 'scoped':
            delete_statement, delete_params = build_scoped_delete_statement(scoped_branch_ids)
            delete_result = conn.execute(delete_statement, delete_params)
            replaced_mappings_count = delete_result.rowcount if delete_result.rowcount is not None else 0

        for offset in range(0, len(mappings), PERSIST_BATCH_SIZE):
            batch_number = (offset // PERSIST_BATCH_SIZE) + 1
            raw_batch = mappings[offset:offset + PERSIST_BATCH_SIZE]
            batch = dedupe_mappings_batch(raw_batch)
            savepoint = conn.begin_nested()

            try:
                statement, params = build_mapping_upsert_statement(batch)
                result = conn.execute(statement, params)
                savepoint.commit()
                affected_rows = (
                    result.rowcount if result.rowcount is not None and result.rowcount >= 0
                    else len(batch)
                )
                persisted_count += affected_rows
                print(
                    f"  Saved batch {batch_number}/{total_batches}: "
                    f"{affected_rows} mapping(s) ({len(batch)} unique customer IDs)"
                )
            except Exception as error:
                savepoint.rollback()
                error_message = f"Batch {batch_number}/{total_batches} failed: {error}"
                errors.append(error_message)
                print(f"  Warning: {error_message}")

    return persisted_count, replaced_mappings_count, errors, delete_mode

def process_job(job_data):
    """Process a batch job"""
    job_id = job_data['jobId']
    file_path = job_data['filePath']
    config = job_data['config']
    replace_existing = parse_bool_flag(job_data.get('replaceExisting', False), False)
    confirm_wipe_all = parse_bool_flag(job_data.get('confirmWipeAll', False), False)
    span = TRACER.start_span('python_batch.process_job') if TRACER is not None else None
    if span is not None:
        span.set_attribute('territory.job.id', job_id)
        span.set_attribute('territory.job.replace_existing', bool(replace_existing))
        span.set_attribute('territory.job.confirm_wipe_all', bool(confirm_wipe_all))
    
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
        
        processed_count = 0
        all_results = []
        all_mappings = []
        pocket_stats = {}
        pocket_centers = {}
        
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
                    
                    # Identify containing pocket at 5km level.
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
                    # Revised mapping distance is pocket-center to branch distance.
                    if selected_branch_info:
                        distance_customer_to_branch = selected_branch_info['distance']
                        
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
        
        # Persist mappings in one transaction while isolating bad chunks behind savepoints.
        replaced_mappings_count = 0
        mapping_persistence_errors = []
        mappings_persisted = 0
        wipe_scope = 'none'
        if all_mappings:
            (
                mappings_persisted,
                replaced_mappings_count,
                mapping_persistence_errors,
                wipe_scope,
            ) = (
                persist_mappings_atomically(
                    job_id,
                    all_mappings,
                    replace_existing=replace_existing,
                    confirm_wipe_all=confirm_wipe_all,
                )
            )
            if mapping_persistence_errors:
                print(f"  Warning: mapping persistence completed with {len(mapping_persistence_errors)} failed batch(es)")
        
        # Finalize job
        stats = {
            "fileName": job_data['fileName'],
            "pocketStats": pocket_stats,
            "totalPockets": len(pocket_stats),
            "totalAccounts": processed_count,
            "mappingsPersisted": mappings_persisted,
            "replaceExisting": bool(replace_existing),
            "confirmWipeAll": bool(confirm_wipe_all),
            "replacedMappingsCount": int(replaced_mappings_count),
            "mappingPersistenceErrors": mapping_persistence_errors,
            "wipeScope": wipe_scope,
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
        print(f"   Mappings saved: {mappings_persisted}")
        
        return {
            'jobId': job_id,
            'total': processed_count,
            'pocketStats': pocket_stats,
            'mappingsPersisted': mappings_persisted,
            'replacedMappingsCount': int(replaced_mappings_count),
            'mappingPersistenceErrors': mapping_persistence_errors,
            'wipeScope': wipe_scope,
            'buffer': None  # File saved to disk
        }
    
    except Exception as e:
        if span is not None:
            span.record_exception(e)
        if SENTRY_ENABLED:
            sentry_sdk.capture_exception(e)
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
    finally:
        if span is not None:
            span.end()

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
            if SENTRY_ENABLED:
                sentry_sdk.capture_exception(e)
            print(f"❌ Queue error: {str(e)}")
            import traceback
            traceback.print_exc()
            print()

    if TRACER_PROVIDER is not None:
        TRACER_PROVIDER.force_flush()
        TRACER_PROVIDER.shutdown()
    if SENTRY_ENABLED:
        sentry_sdk.flush(timeout=2.0)

if __name__ == '__main__':
    main()

