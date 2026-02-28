// Push pending job to Redis for Python worker processing
const { Pool } = require('pg');
const Redis = require('ioredis');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  host: 'localhost',
  port: 5434,
  user: 'postgres',
  password: 'postgres',
  database: 'location_pockets',
});

const redis = new Redis({
  host: 'localhost',
  port: 6379,
});

async function pushPendingJob() {
  try {
    console.log('🔍 Checking for pending jobs...');
    
    // Get pending job
    const jobResult = await pool.query(
      `SELECT job_id, data FROM jobs 
       WHERE status = 'pending' AND type = 'batch_encode' 
       ORDER BY created_at DESC LIMIT 1`
    );
    
    if (jobResult.rows.length === 0) {
      console.log('✅ No pending jobs found');
      process.exit(0);
    }
    
    const job = jobResult.rows[0];
    const jobId = job.job_id;
    const jobData = typeof job.data === 'string' ? JSON.parse(job.data) : job.data;
    const fileName = jobData.fileName;
    
    console.log(`📋 Found pending job: ${jobId}`);
    console.log(`📄 File name: ${fileName}`);
    
    // Find uploaded file
    const uploadDir = path.join(__dirname, 'backend', 'uploads');
    const files = fs.readdirSync(uploadDir)
      .filter(f => f.includes(fileName))
      .map(f => ({
        name: f,
        path: path.join(uploadDir, f),
        time: fs.statSync(path.join(uploadDir, f)).mtime
      }))
      .sort((a, b) => b.time - a.time);
    
    if (files.length === 0) {
      console.error('❌ Uploaded file not found');
      process.exit(1);
    }
    
    const filePath = files[0].path.replace(__dirname + path.sep, '').replace(/\\/g, '/');
    console.log(`📁 File found: ${filePath}`);
    
    // Get config
    const configResult = await pool.query('SELECT * FROM config WHERE id = 1');
    if (configResult.rows.length === 0) {
      console.error('❌ Config not found');
      process.exit(1);
    }
    
    const config = {
      originLat: configResult.rows[0].origin_lat,
      originLon: configResult.rows[0].origin_lon,
      alphabet: configResult.rows[0].alphabet,
    };
    
    // Create job payload
    const jobPayload = {
      jobId,
      filePath,
      fileName,
      config
    };
    
    console.log('📤 Pushing job to Redis queue...');
    
    // Push to Redis
    await redis.lpush('python_batch_jobs', JSON.stringify(jobPayload));
    
    console.log('✅ Job pushed to Redis successfully!');
    console.log('🔄 Python worker should pick it up shortly...');
    
    await pool.end();
    redis.disconnect();
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

pushPendingJob();
