# Monitoring Guide: Playbound Discord Bot & Web Server

This guide provides an overview of how to monitor the health and performance of your Linux VM hosting the Discord bot and the Express web server.

---

## 1. Built-in CLI Tools (The Basics)

Use these tools to get an immediate overview of your system's resource usage.

### **htop** (Process & Resource Monitoring)
`htop` provides a real-time, interactive view of your CPU, RAM, and running processes.
- **Command**: `htop`
- **What to look for**:
  - **CPU Bars**: If they stay consistently at 100%, check which process is consuming resources.
  - **Memory (Mem)**: Ensure there is enough free RAM. High usage with a lot of "swapping" indicates you may need a larger VM.
  - **Press `F6`**: To sort processes by CPU or Memory.

### **df -h** (Disk Usage)
Check how much disk space is available.
- **Command**: `df -h`
- **What to look for**:
  - **Use%**: If the root partition (`/`) is above 90%, the bot or database may crash when trying to write logs or temp files.

### **free -m** (RAM Overview)
A quick summary of memory usage in Megabytes.
- **Command**: `free -m`
- **What to look for**:
  - **available**: This is the most important number. It tells you how much memory is actually free for new processes.

---

## 2. PM2 Specific Monitoring

If you are using PM2 to manage your Node.js processes, it provides built-in tools for monitoring.

### **pm2 monit**
- **Command**: `npx pm2 monit`
- **What to look for**:
  - **Heap Size**: Monitor the memory footprint of your Node.js app. A steady increase over days could indicate a memory leak.
  - **Event Loop Latency**: High latency means your bot might be slow to respond to commands.

### **pm2 logs**
- **Command**: `npx pm2 logs`
- **What to look for**:
  - Real-time error messages, unhandled rejections, or database connection issues.

---

## 3. Uptime Monitoring (External Health Checks)

Since the app includes an Express server, you should monitor its availability from the outside.

### **Webhook Endpoint Check**
Configure an external service (like **UptimeRobot**, **Better Stack**, or **Cronitor**) to ping your `/webhook` or a dedicated `/health` endpoint every 5 minutes.
- **Goal**: Detect if the web server is down or if the network is unreachable.
- **HTTP Status**: During normal operation, `/health` and `/api/health` return **`200`**. While the bot is **gracefully shutting down** (SIGINT/SIGTERM), they return **`503`** with `status: "shutting_down"` so load balancers can drain connections. Treat brief 503s during deploys as expected unless they persist.
- **Details**: See **`docs/OPERATIONS_AND_SHUTDOWN.md`**.

---

## 4. Disk Space Management (Logs)

Node.js applications can generate large log files over time, which can fill up your disk.

### **Managing Logs**
- **Check log size**: `du -sh ~/.pm2/logs/` (if using PM2).
- **Log Rotation**: It is highly recommended to use the `pm2-logrotate` module:
  ```bash
  pm2 install pm2-logrotate
  ```
  This automatically zips and clears old logs so they don't consume all your disk space.

### **Pruning Database Logs**
If you are running MongoDB (Mongoose) locally, ensure the journal files and logs are not growing indefinitely.

---

## 5. Cloud Provider Dashboards

If your VM is hosted on a cloud provider (e.g., AWS, DigitalOcean, Google Cloud, Azure), use their web-based dashboards for long-term trends.

- **CPU Utilization**: Look at the last 7 days. If you're consistently using < 5% CPU, you might be overpaying for a larger VM.
- **Disk I/O**: High disk I/O can slow down database queries.
- **Network In/Out**: Monitor for unusual spikes in traffic, which could indicate a DDoS attack or a bot loop.
- **Alerts**: Set up email or Slack alerts for "CPU > 90% for 5 minutes" so you are notified before the server crashes.

---

## Summary Checklist
- [ ] Run `htop` to check for runaway processes.
- [ ] Run `df -h` to ensure disk space is < 80% full.
- [ ] Check `pm2 logs` for recent errors.
- [ ] Verify external uptime monitor is "Green."
- [ ] Ensure log rotation is active.
