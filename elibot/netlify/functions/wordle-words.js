// netlify/functions/wordle-words.js
// רשימת תשובות אפשריות. מחליטים מתוכה מילה יומית לכל משתמש.
// אפשר להרחיב כרצונך. אין "allowed", כל מילה שנרשמת עם 5 אותיות חוקית.
export const WORDLE_ANSWERS = ["apple", "lemon", "grape", "peach", "mango", "melon", "berry", "chili", "onion", "bread",
"drink", "water", "juice", "sugar", "honey", "salad", "sauce", "spice", "pizza", "table",
"chair", "couch", "plate", "spoon", "knife", "glass", "clock", "plant", "green", "white",
"black", "brown", "color", "light", "darky", "shine", "shade", "storm", "rainy", "cloud",
"sunny", "earth", "beach", "river", "ocean", "music", "sound", "piano", "guitar", "drums",
"voice", "dance", "radio", "smile", "laugh", "happy", "angry", "proud", "trust", "peace",
"heart", "dream", "phone", "mouse", "cable", "power", "watch", "timer", "alarm", "house",
"roomy", "walls", "doors", "floor", "brick", "grass", "stone", "metal", "paper", "penna",
"pencil", "story", "write", "title", "cover", "train", "plane", "truck", "biker", "drive",
"speed", "brake", "hands", "tooth", "heady", "kneeS", "brain", "blood", "mouth", "taste",
"tiger", "zebra", "horse", "sheep", "snake", "whale", "shark", "eagle", "crowd", "chess",
"poker", "sport", "score", "match", "small", "large", "short", "talll", "young", "early",
"later", "quick", "slowy", "space", "stars", "moony", "orbit", "world", "alien", "buter",
"jammy", "meats", "fishy", "salty", "yummy", "shirt", "pants", "dress", "shoes", "scarf",
"belts", "hatsy", "rings", "money", "coins", "notes", "trade", "price", "value", "stock",
"clean", "dirty", "dusty", "fresh", "soapy", "brush", "clear", "tidyy", "movie", "actor",
"scene", "camer", "frame", "paint", "drawn", "image", "color", "light", "sound", "faith",
"logic", "magic", "skill", "level", "quest", "sword", "armor", "arrow", "house", "table",
"plant", "fruit", "grain", "wheat", "candy", "metal", "stone", "glass", "cloth", "wooly"

];
