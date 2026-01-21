# Quick Start: Testing Your Setup

## Fastest Way (Docker - 2 minutes)

### 1. Start Docker Desktop
Make sure Docker Desktop is running on Windows.

### 2. Run Setup Script
```powershell
cd SasWatch
.\scripts\setup-test-db.ps1
```
Choose option 1 (Docker).

### 3. Initialize Database
```powershell
cd SasWatch
$env:DATABASE_URL="postgresql://postgres:postgres@localhost:5432/saswatch_test"
npm run db:push
```

### 4. Run Tests
```powershell
npm test
```

**Done!** ✅

---

## Manual Docker Setup

If the script doesn't work, do it manually:

```powershell
# Start PostgreSQL container
docker run -d `
  --name saswatch-test-db `
  -e POSTGRES_PASSWORD=postgres `
  -e POSTGRES_DB=saswatch_test `
  -p 5432:5432 `
  postgres:15-alpine

# Wait 5 seconds for it to start
Start-Sleep -Seconds 5

# Set up database
cd SasWatch
$env:DATABASE_URL="postgresql://postgres:postgres@localhost:5432/saswatch_test"
npm run db:push

# Run tests
npm test
```

---

## If You Don't Have Docker

### Option 1: Install Docker Desktop (Recommended)
1. Download: https://www.docker.com/products/docker-desktop
2. Install and start Docker Desktop
3. Follow "Fastest Way" above

### Option 2: Use Existing PostgreSQL
If you already have PostgreSQL running:

```powershell
# Create test database (adjust connection string as needed)
psql -U postgres -c "CREATE DATABASE saswatch_test;"

# Set up
cd SasWatch
$env:DATABASE_URL="postgresql://your_user:your_password@localhost:5432/saswatch_test"
npm run db:push
npm test
```

---

## Expected Output

When tests pass, you'll see:

```
✅ Test database connected

 ✓ __tests__/unit/lib/auth.test.js (8)
 ✓ __tests__/integration/multi-tenant-isolation.test.js (5)

 Test Files  2 passed (2)
      Tests  13 passed (13)
   Duration  2-5s
```

---

## Troubleshooting

**"Cannot connect to database"**
- Make sure Docker container is running: `docker ps | grep saswatch-test-db`
- Check port 5432 isn't in use: `netstat -an | findstr 5432`

**"relation does not exist"**
- Run `npm run db:push` again
- Make sure `DATABASE_URL` is set correctly

**"Docker not found"**
- Install Docker Desktop
- Or use your existing PostgreSQL setup

---

**Need help?** See `TEST-SETUP-GUIDE.md` for detailed troubleshooting.
