import { initializeApp } from 'firebase/app';
import { getFirestore, collection, doc, updateDoc, getDocs, query, where, deleteDoc } from 'firebase/firestore';

const firebaseConfig = {
    apiKey: "AIzaSyA6ikBMsQACcUpn4Jff7PQFeWLN8wv18EE",
    authDomain: "matchanese-attendance.firebaseapp.com",
    projectId: "matchanese-attendance",
    storageBucket: "matchanese-attendance.firebasestorage.app",
    messagingSenderId: "339591618451",
    appId: "1:339591618451:web:23f9d95833ee5010bbd266",
    measurementId: "G-YEK4GML6SJ"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Manila Matcha Fest menu with cookies
const manilaMatchaFestMenu = {
    categories: [
        {
            id: "matcha-lattes",
            name: "Matcha Lattes"
        },
        {
            id: "matcha-lite",
            name: "Matcha Lite"
        },
        {
            id: "specials",
            name: "Specials"
        },
        {
            id: "beyond-matcha",
            name: "Beyond Matcha"
        },
        {
            id: "desserts",
            name: "Desserts"
        }
    ],
    items: [
        {
            categoryId: "matcha-lattes",
            name: "signature <span class=\"text-span-2\">matchanese</span> latte",
            description: "Hand-whisked Ceremonial Matcha over Milk",
            price: 200,
            type: "Iced"
        },
        {
            categoryId: "matcha-lattes",
            name: "<span class=\"text-span-2\">matchanese</span> sea salt latte",
            description: "Our Signature Matchanese Latte topped with Salted Cream",
            price: 240,
            tags: ["Best Seller"],
            type: "Iced"
        },
        {
            categoryId: "matcha-lattes",
            name: "strawberry <span class=\"text-span-2\">matchanese</span> latte",
            description: "Our Signature Matchanese Latte topped with Strawberry Puree",
            price: 250,
            tags: ["Must-Try!"],
            type: "Iced"
        },
        {
            categoryId: "matcha-lite",
            name: "<span class=\"text-span-2\">matchanese</span> tea",
            description: "Hand-Whisked Ceremonial Matcha",
            price: 190,
            type: "Iced",
            customizations: {
                size: true,
                serving: true,
                sweetness: false,
                milk: false,
                discount: true
            }
        },
        {
            categoryId: "matcha-lite",
            name: "<span class=\"text-span-2\">matchanese</span> coconut",
            description: "Hand-whisked Ceremonial Matcha over Coconut Juice",
            price: 200,
            type: "Iced",
            customizations: {
                size: true,
                serving: true,
                sweetness: false,
                milk: false,
                discount: true
            }
        },
        {
            categoryId: "matcha-lite",
            name: "<span class=\"text-span-2\">matchanese</span> dalandan",
            description: "Hand-whisked Ceremonial Matcha over Dalandan Juice",
            price: 200,
            type: "Iced",
            customizations: {
                size: true,
                serving: true,
                sweetness: false,
                milk: false,
                discount: true
            }
        },
        {
            categoryId: "specials",
            name: "<span class=\"text-span-2\">matchanese</span> coconut cloud",
            description: "Coconut Juice Topped with matcha Cream and Matcha Powder",
            price: 250,
            tags: ["Limited Time"],
            type: "Iced",
            customizations: {
                size: true,
                serving: true,
                sweetness: false,
                milk: false,
                discount: true
            }
        },
        {
            categoryId: "specials",
            name: "<span class=\"text-span-2\">matchanese</span> float",
            description: "Our Signature Matchanese Latte with a Scoope of our Matcha Ice Cream",
            tags: ["Limited Time"],
            price: 290,
            type: "Iced"
        },
        {
            categoryId: "specials",
            name: "earl grey <span class=\"text-span-2\">matchanese</span> latte",
            description: "Our Signature Matchanese Latte with Earl Grey Syrup",
            tags: ["Limited Time"],
            price: 250,
            type: "Iced"
        },
        {
            categoryId: "specials",
            name: "<span class=\"text-span-2\">matchanese</span> yama latte",
            description: "Our Signature Matchanese Latte topped with Matcha Whipped Cream and Matcha Syrup",
            price: 270,
            type: "Iced"
        },
        {
            categoryId: "beyond-matcha",
            name: "<span class=\"text-span-2\">hojicha</span> latte",
            description: "Freshly Whisked Roasted Green Tea over Milk",
            price: 180,
            type: "Iced"
        },
        {
            categoryId: "desserts",
            name: "matcha <span class=\"text-span-2\">cookie</span>",
            description: "Delicious matcha cookies with various flavors",
            price: 165,
            type: "",
            variants: [
                { name: "Matcha Bomb", price: 0 },
                { name: "Matcha Dark Choco", price: 0 },
                { name: "Matcha White Choco", price: 0 }
            ],
            customizations: {
                size: false,
                serving: false,
                sweetness: false,
                milk: false
            }
        },
        {
            categoryId: "desserts",
            name: "<span class=\"text-span-2\">matcha tiramisu</span>",
            description: "",
            price: 240,
            type: "",
            customizations: {
                size: false,
                serving: false,
                sweetness: false,
                milk: false
            }
        },
        {
            categoryId: "desserts",
            name: "<span class=\"text-span-2\">warabi mochi</span>",
            description: "",
            price: 270,
            type: "",
            variants: [
                { name: "Matcha", price: 0 },
                { name: "Kinako", price: 0 },
            ],
            customizations: {
                size: false,
                serving: false,
                sweetness: false,
                milk: false
            }
        },
        {
            categoryId: "desserts",
            name: "<span class=\"text-span-2\">matcha ice cream - scoop</span>",
            description: "",
            price: 160,
            type: "",
            customizations: {
                size: false,
                serving: false,
                sweetness: false,
                milk: false
            }
        },
        {
            categoryId: "desserts",
            name: "<span class=\"text-span-2\">matcha ice cream level one</span>",
            description: "",
            price: 160,
            type: "",
            customizations: {
                size: false,
                serving: false,
                sweetness: false,
                milk: false
            }
        },
        {
            categoryId: "desserts",
            name: "<span class=\"text-span-2\">matcha ice cream level two</span>",
            description: "",
            price: 190,
            type: "",
            customizations: {
                size: false,
                serving: false,
                sweetness: false,
                milk: false
            }
        },
        {
            categoryId: "desserts",
            name: "<span class=\"text-span-2\">matcha ice cream level three</span>",
            description: "",
            price: 220,
            type: "",
            customizations: {
                size: false,
                serving: false,
                sweetness: false,
                milk: false
            }
        }
    ]
};

async function fixManilaMatchaFest() {
    try {
        console.log('🔧 Fixing Manila Matcha Fest events...\n');
        
        const branchesRef = collection(db, 'branches');
        
        // Find all Manila Matcha Fest events
        const allSnapshot = await getDocs(branchesRef);
        const events = [];
        
        allSnapshot.forEach(doc => {
            const data = doc.data();
            if (data.name && data.name.toLowerCase().includes('manila matcha fest')) {
                events.push({ id: doc.id, ...data });
            }
        });
        
        console.log(`Found ${events.length} Manila Matcha Fest event(s):`);
        events.forEach(event => {
            console.log(`  - ${event.name} (key: ${event.key}, doc ID: ${event.id})`);
        });
        console.log('');
        
        // Find the 2026 event
        const event2026 = events.find(e => 
            e.name.includes('2026') || e.key.includes('2026')
        );
        
        // Find the duplicate event (the one I just created)
        const duplicateEvent = events.find(e => 
            e.key === 'manila-matcha-fest' && !e.name.includes('2026')
        );
        
        if (!event2026) {
            console.error('❌ Could not find Manila Matcha Fest 2026 event!');
            console.log('Available events:', events.map(e => e.name));
            process.exit(1);
        }
        
        // Update the correct 2026 event with custom menu
        console.log(`✅ Updating existing event: ${event2026.name}`);
        const eventRef = doc(db, 'branches', event2026.id);
        await updateDoc(eventRef, {
            customMenu: manilaMatchaFestMenu
        });
        console.log('   Custom menu with cookies added!\n');
        
        // Delete the duplicate event if it exists
        if (duplicateEvent) {
            console.log(`🗑️  Deleting duplicate event: ${duplicateEvent.name}`);
            const duplicateRef = doc(db, 'branches', duplicateEvent.id);
            await deleteDoc(duplicateRef);
            console.log('   Duplicate event removed!\n');
        }
        
        console.log('✅ Successfully fixed Manila Matcha Fest 2026!');
        console.log('Cookies with variants:');
        console.log('  - Matcha Bomb');
        console.log('  - Matcha Dark Choco');
        console.log('  - Matcha White Choco');
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Error fixing Manila Matcha Fest:', error);
        process.exit(1);
    }
}

fixManilaMatchaFest();
