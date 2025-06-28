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
            // tags: ["signature"],
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
            name: "<span class=\"text-span-2\">matchanese</span> coconut",
            description: "Hand-whisked Ceremonial Matcha over Coconut Juice",
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
            categoryId: "matcha-lite",
            name: "<span class=\"text-span-2\">matchanese</span> dalandan",
            description: "Hand-whisked Ceremonial Matcha over Dalandan Juice",
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
            name: "<span class=\"text-span-2\">matchanese</span> coconut cloud",
            description: "Coconut Juice Topped with matcha Cream and Matcha Powder",
            price: 250,
            tags: ["Limited Time"],
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
            name: "earl grey <span class=\"text-span-2\">matchanese</span> latte",
            description: "Our Signature Matchanese Latte with Earl Grey Syrup",
            tags: ["Limited Time"],
            price: 250,
            type: "Iced"
        },
        {
            categoryId: "specials",
            name: "triple <span class=\"text-span-2\">matchanese</span> cloud",
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
        },
        // {
        //     categoryId: "desserts",
        //     name: "<span class=\"text-span-2\">warabi mochi</span> (box)",
        //     description: "",
        //     price: 270,
        //     type: "",
        //     variants: [
        //         { name: "Matcha", price: 0 },
        //         { name: "Kinako", price: 0 },
        //     ],
        //     customizations: {
        //         size: false,      // Can customize size
        //         serving: false,   // Can customize serving
        //         sweetness: false, // Can customize sweetness
        //         milk: false      // Cannot customize milk
        //     }
        // },
        // {
        //     categoryId: "desserts",
        //     name: "<span class=\"text-span-2\">warabi mochi</span> (cup)",
        //     description: "",
        //     price: 105,
        //     type: "",
        //     variants: [
        //         { name: "Matcha", price: 0 },
        //         { name: "Kinako", price: 0 },
        //     ],
        //     customizations: {
        //         size: false,      // Can customize size
        //         serving: false,   // Can customize serving
        //         sweetness: false, // Can customize sweetness
        //         milk: false      // Cannot customize milk
        //     }
        // },
        {
            categoryId: "desserts",
            name: "matcha <span class=\"text-span-2\">cookie</span>",
            description: "",
            price: 165,
            type: "",
            variants: [
                { name: "Matcha Bomb", price: 0 },
                { name: "Matcha White Chocolate", price: 0 },
                { name: "Matcha Dark Chocolate", price: 0 },
                { name: "Matcha Oreo", price: 0 }
            ],
            customizations: {
                size: false,      // Can customize size
                serving: false,   // Can customize serving
                sweetness: false, // Can customize sweetness
                milk: false      // Cannot customize milk
            }
        },
        {
            categoryId: "desserts",
            name: "<span class=\"text-span-2\">obanyaki</span>",
            description: "",
            price: 80,
            type: "",
            customizations: {
                size: false,      // Can customize size
                serving: false,   // Can customize serving
                sweetness: false, // Can customize sweetness
                milk: false      // Cannot customize milk
            }
        }
    ]
};