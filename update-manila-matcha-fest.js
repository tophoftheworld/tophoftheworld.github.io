import { initializeApp } from 'firebase/app';
import { getFirestore, collection, doc, setDoc, getDocs, query, where } from 'firebase/firestore';

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

async function updateManilaMatchaFest() {
    try {
        console.log('Connecting to Firebase...');
        
        // Check if Manila Matcha Fest event exists
        const branchesRef = collection(db, 'branches');
        const q = query(branchesRef, where('key', '==', 'manila-matcha-fest'));
        const snapshot = await getDocs(q);
        
        let eventDocId;
        if (!snapshot.empty) {
            // Event exists, get its document ID
            eventDocId = snapshot.docs[0].id;
            console.log('Found existing Manila Matcha Fest event:', eventDocId);
        } else {
            // Create new event with a generated ID
            console.log('Manila Matcha Fest event not found, will create new one');
            eventDocId = 'manila-matcha-fest-' + Date.now();
        }
        
        // Update or create the event
        const eventData = {
            key: 'manila-matcha-fest',
            name: 'Manila Matcha Fest',
            type: 'popup',
            serviceType: 'popup',
            archived: false,
            customMenu: manilaMatchaFestMenu
        };
        
        const eventRef = doc(db, 'branches', eventDocId);
        await setDoc(eventRef, eventData, { merge: true });
        
        console.log('✅ Successfully updated Manila Matcha Fest event in Firebase!');
        console.log('Event key:', eventData.key);
        console.log('Event name:', eventData.name);
        console.log('Menu items count:', manilaMatchaFestMenu.items.length);
        console.log('Cookies with variants:', 
            manilaMatchaFestMenu.items
                .filter(item => item.variants)
                .map(item => ({
                    name: item.name.replace(/<[^>]*>/g, ''),
                    variants: item.variants.map(v => v.name)
                }))
        );
        
        process.exit(0);
    } catch (error) {
        console.error('Error updating Manila Matcha Fest:', error);
        process.exit(1);
    }
}

updateManilaMatchaFest();
