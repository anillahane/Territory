FROM python:3.11-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy worker script
COPY worker.py .

# Create uploads directory
RUN mkdir -p /app/uploads

# Run worker
CMD ["python", "-u", "worker.py"]
