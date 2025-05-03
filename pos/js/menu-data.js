// Menu data structure
const menuData = {
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
            tags: ["best seller"],
            type: "Iced"
        },
        {
            categoryId: "matcha-lattes",
            name: "strawberry <span class=\"text-span-2\">matchanese</span> latte",
            description: "Our Signature Matchanese Latte topped with Strawberry Puree",
            price: 250,
            type: "Iced"
        },
        {
            categoryId: "matcha-lite",
            name: "<span class=\"text-span-2\">matchanese</span> tea",
            description: "Hand-Whisked Ceremonial Matcha",
            price: 180,
            // tags: ["classic"],
            type: "Iced"
        },
        {
            categoryId: "matcha-lite",
            name: "<span class=\"text-span-2\">matchanese</span> coconut",
            description: "Hand-whisked Ceremonial Matcha over Coconut Juice",
            price: 190,
            type: "Iced"
        },
        {
            categoryId: "specials",
            name: "<span class=\"text-span-2\">matchanese</span> coconut cloud",
            description: "Coconut Juice Topped with matcha Cream and Matcha Powder",
            price: 270,
            // tags: ["best-seller"],
            type: "Iced"
        },
        {
            categoryId: "specials",
            name: "peach mango <span class=\"text-span-2\">matchanese</span> latte",
            description: "Our Signature Matchanese Latte with Peach Syrup and Mango Puree",
            price: 270,
            type: "Iced"
        },
        {
            categoryId: "specials",
            name: "triple <span class=\"text-span-2\">matchanese</span> cloud",
            description: "Our Signature Matchanese Latte topped with Matcha Cream and Matcha Powder",
            price: 270,
            type: "Iced"
        }
    ]
};