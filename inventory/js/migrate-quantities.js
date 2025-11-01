import { db } from './firebase-inventory.js';
import { collection, getDocs, doc, setDoc, deleteDoc, getDoc } from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js';

console.log('=== QUANTITY MIGRATION SCRIPT ===');

async function migrateQuantitiesToBranchSubcollections() {
    console.log('Starting migration from individual documents to branch subcollections...');
    
    try {
        // Get all existing quantity documents from root collection
        const snapshot = await getDocs(collection(db, 'inventory-quantities'));
        console.log(`Found ${snapshot.size} documents to migrate`);
        
        if (snapshot.size === 0) {
            console.log('No documents to migrate. Migration complete.');
            return;
        }
        
        // Group by branch and date
        const groupedData = {};
        
        snapshot.forEach(docSnapshot => {
            const data = docSnapshot.data();
            
            // Skip if already in new format (has 'quantities' field)
            if (data.quantities) {
                console.log(`Skipping document ${docSnapshot.id} - already in new format`);
                return;
            }
            
            const key = `${data.branch}-${data.date}`;
            
            if (!groupedData[key]) {
                groupedData[key] = {
                    branch: data.branch,
                    date: data.date,
                    quantities: {},
                    lastUpdated: data.timestamp || new Date().toISOString()
                };
            }
            
            // Add this item/mode to the group
            if (!groupedData[key].quantities[data.itemId]) {
                groupedData[key].quantities[data.itemId] = {
                    opening: { value: 0, checked: false },
                    closing: { value: 0, checked: false }
                };
            }
            
            groupedData[key].quantities[data.itemId][data.mode] = {
                value: data.value,
                checked: true,
                timestamp: data.timestamp || new Date().toISOString()
            };
        });
        
        console.log(`Grouped into ${Object.keys(groupedData).length} daily documents`);
        
        // Create new daily documents in branch subcollections
        for (const [key, data] of Object.entries(groupedData)) {
            const [branch, date] = key.split('-', 2);
            const docRef = doc(db, 'inventory-quantities', branch, date);
            
            // Check if document already exists
            const existingDoc = await getDoc(docRef);
            if (existingDoc.exists()) {
                console.log(`Document already exists: ${branch}/${date}, skipping...`);
                continue;
            }
            
            await setDoc(docRef, data);
            console.log(`Created daily document: ${branch}/${date} with ${Object.keys(data.quantities).length} items`);
        }
        
        // Delete old individual documents
        console.log('Deleting old individual documents...');
        let deletedCount = 0;
        for (const docSnapshot of snapshot.docs) {
            const data = docSnapshot.data();
            
            // Only delete if it's in old format (no 'quantities' field)
            if (!data.quantities) {
                await deleteDoc(docSnapshot.ref);
                deletedCount++;
            }
        }
        
        console.log(`Deleted ${deletedCount} old documents`);
        console.log('Migration completed successfully!');
        
        // Show summary
        console.log('\n=== MIGRATION SUMMARY ===');
        console.log(`Original documents: ${snapshot.size}`);
        console.log(`New daily documents: ${Object.keys(groupedData).length}`);
        console.log(`Documents deleted: ${deletedCount}`);
        console.log(`Reduction: ${Math.round((1 - Object.keys(groupedData).length / snapshot.size) * 100)}%`);
        
    } catch (error) {
        console.error('Migration failed:', error);
        throw error;
    }
}

// Function to verify migration
async function verifyMigration() {
    console.log('\n=== VERIFICATION ===');
    
    try {
        // Check root collection (should be empty or only have new format)
        const rootSnapshot = await getDocs(collection(db, 'inventory-quantities'));
        let oldFormatCount = 0;
        let newFormatCount = 0;
        
        rootSnapshot.forEach(doc => {
            if (doc.data().quantities) {
                newFormatCount++;
            } else {
                oldFormatCount++;
            }
        });
        
        console.log(`Root collection - Old format: ${oldFormatCount}, New format: ${newFormatCount}`);
        
        // Check branch subcollections
        const branches = ['sm-north', 'podium'];
        for (const branch of branches) {
            try {
                const branchSnapshot = await getDocs(collection(db, 'inventory-quantities', branch));
                console.log(`Branch ${branch}: ${branchSnapshot.size} daily documents`);
                
                // Check a sample document structure
                if (branchSnapshot.size > 0) {
                    const sampleDoc = branchSnapshot.docs[0];
                    const data = sampleDoc.data();
                    console.log(`  Sample document ${sampleDoc.id}: ${Object.keys(data.quantities || {}).length} items`);
                }
            } catch (error) {
                console.log(`Branch ${branch}: No subcollection found (this is normal if no data exists)`);
            }
        }
        
    } catch (error) {
        console.error('Verification failed:', error);
    }
}

// Export functions for use
window.migrateQuantitiesToBranchSubcollections = migrateQuantitiesToBranchSubcollections;
window.verifyMigration = verifyMigration;

console.log('Migration script loaded. Use:');
console.log('- migrateQuantitiesToBranchSubcollections() to run migration');
console.log('- verifyMigration() to check results');
