export const menuData = {
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
        }
    ],
    items: [
        {
            categoryId: "matcha-lattes",
            name: "signature <span class=\"text-span-2\">matchanese</span> latte",
            description: "Hand-whisked Ceremonial Matcha over Milk",
            price: 200,
            // tags: ["signature"],
            type: "Iced"
        },
        {
            categoryId: "matcha-lattes",
            name: "spanish <span class=\"text-span-2\">matchanese</span> latte",
            description: "Our Signature Matchanese Latte with Four kinds of Milk",
            price: 240,
            tags: ["Best Seller"],
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
            // tags: ["classic"],
            type: "Iced",
            customizations: {
                size: true,      // Can customize size
                serving: true,   // Can customize serving
                sweetness: false, // Can customize sweetness
                milk: false,     // Cannot customize milk
                discount: true
            }
        },
        {
            categoryId: "matcha-lite",
            name: "<span class=\"text-span-2\">matchanese</span> sunrise",
            description: "Hand-whisked Ceremonial Matcha over Orange Juice",
            price: 200,
            type: "Iced",
            customizations: {
                size: true,      // Can customize size
                serving: true,   // Can customize serving
                sweetness: false, // Can customize sweetness
                milk: false,
                discount: true
            }
        },
        {
            categoryId: "specials",
            name: "<span class=\"text-span-2\">matchanese</span> cloud",
            description: "Our Signature Matchanese Latte topped with Matcha Cream and Matcha Powder",
            price: 270,
            type: "Iced"
        },
        {
            categoryId: "beyond-matcha",
            name: "<span class=\"text-span-2\">hojicha</span> latte",
            description: "Freshly Whisked Roasted Green Tea over Milk",
            price: 180,
            // tags: ["best-seller"],
            type: "Iced"
        }
    ]
};