# Sales Data Migration - SM North to New Structure

## Overview
Migrated SM North sales data from the old `sales` collection to a new structured path: `sales-data/sm-north/daily`, matching the Podium branch structure.

## Why This Migration?

**Before:**
- SM North: `sales` collection (flat structure)
- Podium: `sales-data/podium/daily` collection (nested structure)

**After:**
- SM North: `sales-data/sm-north/daily` collection (nested structure)
- Podium: `sales-data/podium/daily` collection (nested structure)

Now both branches use a consistent, organized structure.

## Migration Steps

### 1. Run Migration Tool
Open `migrate-sales-data.html` in your browser to:
- Copy all existing SM North sales from `sales` → `sales-data/sm-north/daily`
- Verify the migration was successful
- Check record counts match

### 2. Updated Files

#### `daily-sales.html`
- **Old:** Writes to `doc(db, "sales", recordDate)`
- **New:** Writes to `doc(db, "sales-data", "sm-north", "daily", recordDate)`
- Also updated Grab CSV upload functionality

#### `sales/js/dashboard.js`
- **Old:** Reads SM North from `collection(db, 'sales')`
- **New:** Reads SM North from `collection(db, 'sales-data', 'sm-north', 'daily')`

#### `migrate-sales-data.html` (NEW)
- Interactive migration tool with verification
- Safe to run multiple times (skips existing records)
- Shows detailed logs and statistics

## Branch Structure

```
sales-data/
  ├── sm-north/
  │   └── daily/
  │       ├── 2024-01-01
  │       ├── 2024-01-02
  │       └── ...
  └── podium/
      └── daily/
          ├── 2024-01-01
          ├── 2024-01-02
          └── ...
```

## Testing

1. **Migration Tool**
   - Open `migrate-sales-data.html`
   - Click "Check Old Data" to verify source data
   - Click "Start Migration" to copy data
   - Click "Verify Migration" to confirm success

2. **Sales Dashboard**
   - Open `sales/sales-dashboard.html`
   - Select "SM North" branch
   - Verify data loads correctly

3. **Daily Sales Entry**
   - Open `daily-sales.html`
   - Submit a test record
   - Verify it appears in the dashboard

## Important Notes

- **Original data is preserved** - The migration tool only copies, it doesn't delete
- **Safe to rerun** - The tool skips already migrated records
- **No downtime** - Apps work with both old and new structures during transition
- **Rollback available** - Original data in `sales` collection remains untouched

## Next Steps (Optional)

Once you've verified everything works:
1. Consider archiving the old `sales` collection
2. Update any other scripts that reference `sales` collection
3. Document the new structure for future developers

## Support

If you encounter issues:
1. Check browser console for errors
2. Verify Firebase permissions are correct
3. Ensure you're using the latest versions of the files

