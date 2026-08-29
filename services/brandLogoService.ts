// Brand Logo Service - High-definition SVG vectors and colors for major national and North Carolina regional brands
import React from 'react';

export interface BrandMeta {
    id: string;
    name: string;
    keywords: string[];
    bg: string;
    border: string;
    svg: string; // SVG path or elements
}

export const BRAND_REGISTRY: Record<string, BrandMeta> = {
    // --- North Carolina & Regional Supermarkets ---
    foodlion: {
        id: 'foodlion',
        name: 'Food Lion',
        keywords: ['food lion', 'foodlion'],
        bg: '#002B49',
        border: '#E5A823',
        svg: `<svg viewBox="0 0 24 24" fill="none" class="w-full h-full"><rect x="2" y="4" width="20" height="16" rx="3" fill="#002B49"/><path d="M6 14C6 11 8 8 12 8C14 8 15.5 9 16 10C15 10 14 10.5 14 12C14 13.5 15.5 14 17 13.5C16.5 16 14.5 17 12 17C9 17 6 15.5 6 14Z" fill="#FFFFFF"/><path d="M12 9C12.5 8 14 6 17 7C17.5 7.2 16.5 8.5 15 9H12Z" fill="#E5A823"/><circle cx="10" cy="11.5" r="1" fill="#002B49"/><text x="5" y="19" font-size="3.5" font-weight="900" fill="#FFFFFF" font-family="Arial Black, sans-serif">FOOD LION</text></svg>`
    },
    carliecs: {
        id: 'carliecs',
        name: "Carlie C's IGA",
        keywords: ['carlie c', 'carlie cs', "carlie c's", "carlie c's iga", 'carlie cs iga', 'carlie c’s'],
        bg: '#C8102E',
        border: '#00873D',
        svg: `<svg viewBox="0 0 24 24" fill="none" class="w-full h-full"><rect x="2" y="4" width="20" height="16" rx="3" fill="#C8102E"/><rect x="4" y="6" width="16" height="6.5" rx="1.5" fill="#FFFFFF"/><text x="4.8" y="11" font-size="3.8" font-weight="900" fill="#C8102E" font-family="Arial Black, sans-serif">CARLIE C'S</text><rect x="6.5" y="13.5" width="11" height="5" rx="2.5" fill="#00873D"/><text x="9" y="17.2" font-size="4.2" font-weight="900" fill="#FFFFFF" font-family="Arial Black, sans-serif">IGA</text></svg>`
    },
    harristeeter: {
        id: 'harristeeter',
        name: 'Harris Teeter',
        keywords: ['harris teeter', 'harristeeter', 'harris teeter supermarket'],
        bg: '#007A33',
        border: '#E31837',
        svg: `<svg viewBox="0 0 24 24" fill="none" class="w-full h-full"><rect x="2" y="4" width="20" height="16" rx="3" fill="#007A33"/><circle cx="8.5" cy="10" r="3.2" fill="#E31837"/><path d="M8.5 6.8C9.5 5.5 11 6 11 6C11 6 10.2 7.2 9.2 7.2" stroke="#FFFFFF" stroke-width="0.8" fill="#FFFFFF"/><path d="M12.5 11C13.5 9 16 9 17.5 10C16 11 16 12 17.5 13C15.5 13.5 13.5 12.5 12.5 11Z" fill="#FFFFFF"/><text x="3.5" y="18" font-size="3.2" font-weight="900" fill="#FFFFFF" font-family="Arial, sans-serif">Harris Teeter</text></svg>`
    },
    publix: {
        id: 'publix',
        name: 'Publix',
        keywords: ['publix', 'publix supermarket'],
        bg: '#006644',
        border: '#FFFFFF',
        svg: `<svg viewBox="0 0 24 24" fill="none" class="w-full h-full"><circle cx="12" cy="12" r="9.5" fill="#006644"/><circle cx="12" cy="12" r="7.5" stroke="#FFFFFF" stroke-width="1.8"/><text x="7.8" y="16.5" font-size="13" font-weight="900" fill="#FFFFFF" font-family="Arial Black, sans-serif">P</text></svg>`
    },
    pigglywiggly: {
        id: 'pigglywiggly',
        name: 'Piggly Wiggly',
        keywords: ['piggly wiggly', 'pigglywiggly', 'the pig'],
        bg: '#EE3124',
        border: '#FFFFFF',
        svg: `<svg viewBox="0 0 24 24" fill="none" class="w-full h-full"><circle cx="12" cy="12" r="9.5" fill="#EE3124"/><circle cx="12" cy="12" r="7" fill="#FFFFFF"/><path d="M9 8C8 6 10 5.5 11 7" stroke="#EE3124" stroke-width="1.2"/><path d="M15 8C16 6 14 5.5 13 7" stroke="#EE3124" stroke-width="1.2"/><ellipse cx="12" cy="14" rx="3.5" ry="2.5" fill="#FFC0CB"/><circle cx="10.8" cy="14" r="0.8" fill="#EE3124"/><circle cx="13.2" cy="14" r="0.8" fill="#EE3124"/><circle cx="9.5" cy="10.5" r="1" fill="#000000"/><circle cx="14.5" cy="10.5" r="1" fill="#000000"/></svg>`
    },
    lowesfoods: {
        id: 'lowesfoods',
        name: 'Lowes Foods',
        keywords: ['lowes foods', 'lowes food', 'lowe’s foods'],
        bg: '#2E6930',
        border: '#D4A017',
        svg: `<svg viewBox="0 0 24 24" fill="none" class="w-full h-full"><rect x="3" y="4" width="18" height="16" rx="3" fill="#2E6930"/><path d="M6 14L12 8L18 14H6Z" fill="#D4A017"/><text x="4" y="18" font-size="3" font-weight="900" fill="#FFFFFF" font-family="Arial Black, sans-serif">LOWES FOODS</text></svg>`
    },
    thefreshmarket: {
        id: 'thefreshmarket',
        name: 'The Fresh Market',
        keywords: ['fresh market', 'the fresh market'],
        bg: '#1D3C34',
        border: '#C29B38',
        svg: `<svg viewBox="0 0 24 24" fill="none" class="w-full h-full"><circle cx="12" cy="12" r="9.5" fill="#1D3C34"/><circle cx="12" cy="12" r="7.5" stroke="#C29B38" stroke-width="1.2"/><text x="5.5" y="11" font-size="3.2" font-weight="bold" fill="#FFFFFF" font-family="Georgia, serif">THE FRESH</text><text x="6" y="15" font-size="3.2" font-weight="bold" fill="#C29B38" font-family="Georgia, serif">MARKET</text></svg>`
    },
    lidl: {
        id: 'lidl',
        name: 'Lidl',
        keywords: ['lidl', 'lidl us'],
        bg: '#0050AA',
        border: '#FFF000',
        svg: `<svg viewBox="0 0 24 24" fill="none" class="w-full h-full"><circle cx="12" cy="12" r="9.5" fill="#0050AA" stroke="#FFF000" stroke-width="1.5"/><circle cx="12" cy="12" r="7.5" fill="#FFF000"/><text x="5.5" y="15.5" font-size="7" font-weight="900" fill="#0050AA" font-family="Arial Black, sans-serif">L</text><text x="9.5" y="15.5" font-size="7" font-weight="900" fill="#E60000" font-family="Arial Black, sans-serif">I</text><text x="11.5" y="15.5" font-size="7" font-weight="900" fill="#0050AA" font-family="Arial Black, sans-serif">DL</text></svg>`
    },
    aldi: {
        id: 'aldi',
        name: 'ALDI',
        keywords: ['aldi', 'aldi foods', 'aldi supermarket'],
        bg: '#00205B',
        border: '#EB780A',
        svg: `<svg viewBox="0 0 24 24" fill="none" class="w-full h-full"><rect x="3" y="4" width="18" height="16" rx="2" fill="#00205B"/><path d="M7 16L12 6L17 16H13.5L12 12.5L10.5 16H7Z" fill="#EB780A"/><path d="M9 16L12 9.5L15 16H13L12 13.5L11 16H9Z" fill="#00A3E0"/><text x="6" y="19" font-size="3" font-weight="900" fill="#FFFFFF" font-family="Arial Black, sans-serif">ALDI</text></svg>`
    },
    traderjoes: {
        id: 'traderjoes',
        name: "Trader Joe's",
        keywords: ['trader joe', 'trader joes', "trader joe's"],
        bg: '#BA0C2F',
        border: '#FFFFFF',
        svg: `<svg viewBox="0 0 24 24" fill="none" class="w-full h-full"><circle cx="12" cy="12" r="9.5" fill="#BA0C2F"/><circle cx="12" cy="12" r="8" stroke="#FFFFFF" stroke-width="0.8"/><text x="4" y="11.5" font-size="3.5" font-weight="bold" fill="#FFFFFF" font-family="Georgia, serif">TRADER</text><text x="5.5" y="15.5" font-size="3.5" font-weight="bold" fill="#FFFFFF" font-family="Georgia, serif">JOE'S</text></svg>`
    },
    wholefoods: {
        id: 'wholefoods',
        name: 'Whole Foods Market',
        keywords: ['whole foods', 'wholefoods', 'whole foods market'],
        bg: '#004C3F',
        border: '#74C043',
        svg: `<svg viewBox="0 0 24 24" fill="none" class="w-full h-full"><circle cx="12" cy="12" r="9.5" fill="#004C3F"/><path d="M6 13C6 8 9 6 12 6C15 6 18 8 18 13C18 17 15 18 12 18C9 18 6 17 6 13Z" fill="#FFFFFF"/><path d="M12 6C13.5 4 16 5 16 5C16 5 15 7 13.5 7.5" stroke="#74C043" stroke-width="1.2"/><text x="7" y="14" font-size="3" font-weight="900" fill="#004C3F" font-family="Arial Black, sans-serif">WHOLE</text><text x="7.5" y="17" font-size="2.5" font-weight="900" fill="#004C3F" font-family="Arial Black, sans-serif">FOODS</text></svg>`
    },

    // --- Beloved North Carolina Food & Gas Chains ---
    bojangles: {
        id: 'bojangles',
        name: 'Bojangles',
        keywords: ['bojangles', 'bojangle', "bojangles'"],
        bg: '#FFD100',
        border: '#E31837',
        svg: `<svg viewBox="0 0 24 24" fill="none" class="w-full h-full"><circle cx="12" cy="12" r="9.5" fill="#FFD100"/><path d="M12 4L13.5 7.5H17L14 9.5L15.5 13L12 11L8.5 13L10 9.5L7 7.5H10.5L12 4Z" fill="#E31837"/><text x="4" y="17" font-size="4.2" font-style="italic" font-weight="900" fill="#E31837" font-family="Arial Black, sans-serif">Bojangles</text></svg>`
    },
    cookout: {
        id: 'cookout',
        name: 'Cook Out',
        keywords: ['cook out', 'cookout'],
        bg: '#E31837',
        border: '#FFD100',
        svg: `<svg viewBox="0 0 24 24" fill="none" class="w-full h-full"><rect x="2" y="4" width="20" height="16" rx="3" fill="#E31837"/><rect x="4" y="6" width="16" height="5" rx="1" fill="#FFD100"/><text x="4.5" y="10" font-size="4" font-weight="900" fill="#E31837" font-family="Arial Black, sans-serif">COOK OUT</text><rect x="5" y="13" width="14" height="2" rx="1" fill="#FFD100"/><rect x="6" y="16" width="12" height="1.5" rx="0.5" fill="#FFFFFF"/></svg>`
    },
    sheetz: {
        id: 'sheetz',
        name: 'Sheetz',
        keywords: ['sheetz'],
        bg: '#C8102E',
        border: '#FFD100',
        svg: `<svg viewBox="0 0 24 24" fill="none" class="w-full h-full"><rect x="3" y="4" width="18" height="16" rx="4" fill="#C8102E" stroke="#FFD100" stroke-width="1.2"/><text x="6" y="16.5" font-size="14" font-style="italic" font-weight="900" fill="#FFD100" font-family="Arial Black, sans-serif">S</text></svg>`
    },

    // --- Major National Fast Food & Dining ---
    mcdonalds: {
        id: 'mcdonalds',
        name: "McDonald's",
        keywords: ['mcdonald', 'mcdonalds', "mcdonald's"],
        bg: '#DA291C',
        border: '#FFC72C',
        svg: `<svg viewBox="0 0 24 24" fill="none" class="w-full h-full"><path d="M4 20C4 13.5 6.2 8 8.8 8C10.5 8 11.6 11 12 13.5C12.4 11 13.5 8 15.2 8C17.8 8 20 13.5 20 20H17.2C17.2 14.5 15.8 10.4 14.4 10.4C13 10.4 12.2 13.8 12.2 18H11.8C11.8 13.8 11 10.4 9.6 10.4C8.2 10.4 6.8 14.5 6.8 20H4Z" fill="#FFC72C"/></svg>`
    },
    tacobell: {
        id: 'tacobell',
        name: 'Taco Bell',
        keywords: ['taco bell', 'tacobell'],
        bg: '#702082',
        border: '#A77BCA',
        svg: `<svg viewBox="0 0 24 24" fill="none" class="w-full h-full"><path d="M12 3C8.5 3 6.5 6 6 10C5.5 14 4 15.5 3 16.5H21C20 15.5 18.5 14 18 10C17.5 6 15.5 3 12 3Z" fill="#FFFFFF"/><circle cx="12" cy="18" r="2.5" fill="#E31837"/><path d="M10 6C11 5.2 13 5.2 14 6" stroke="#702082" stroke-width="1.5" stroke-linecap="round"/></svg>`
    },
    starbucks: {
        id: 'starbucks',
        name: 'Starbucks',
        keywords: ['starbucks', 'starbucks coffee'],
        bg: '#006241',
        border: '#00754A',
        svg: `<svg viewBox="0 0 24 24" fill="none" class="w-full h-full"><circle cx="12" cy="12" r="10" fill="#006241"/><circle cx="12" cy="12" r="8.5" stroke="#FFFFFF" stroke-width="0.8"/><path d="M12 6L13.2 9H16.2L13.8 10.8L14.7 13.8L12 12L9.3 13.8L10.2 10.8L7.8 9H10.8L12 6Z" fill="#FFFFFF"/><path d="M8 17C10 18.5 14 18.5 16 17" stroke="#FFFFFF" stroke-width="1.2" stroke-linecap="round"/></svg>`
    },
    subway: {
        id: 'subway',
        name: 'Subway',
        keywords: ['subway'],
        bg: '#008C15',
        border: '#FFC20E',
        svg: `<svg viewBox="0 0 24 24" fill="none" class="w-full h-full"><path d="M5 9L9 5V8H14C16.8 8 19 10.2 19 13C19 15.8 16.8 18 14 18H7V15H14C15.1 15 16 14.1 16 13C16 11.9 15.1 11 14 11H9V14L5 9Z" fill="#FFC20E"/><path d="M19 15L15 19V16H10C7.2 16 5 13.8 5 11H8C8 12.1 8.9 13 10 13H15V10L19 15Z" fill="#FFFFFF"/></svg>`
    },
    wendys: {
        id: 'wendys',
        name: "Wendy's",
        keywords: ['wendy', 'wendys', "wendy's"],
        bg: '#E2231A',
        border: '#1990EA',
        svg: `<svg viewBox="0 0 24 24" fill="none" class="w-full h-full"><circle cx="12" cy="12" r="9" fill="#FFFFFF"/><path d="M8 9C8 7 10 6 12 6C14 6 16 7 16 9C17.5 9 18 10.5 18 12C18 15 15.5 17 12 17C8.5 17 6 15 6 12C6 10.5 6.5 9 8 9Z" fill="#E2231A"/><circle cx="10" cy="11" r="1" fill="#FFFFFF"/><circle cx="14" cy="11" r="1" fill="#FFFFFF"/><path d="M10.5 14C11 14.8 13 14.8 13.5 14" stroke="#FFFFFF" stroke-width="1.2" stroke-linecap="round"/></svg>`
    },
    burgerking: {
        id: 'burgerking',
        name: 'Burger King',
        keywords: ['burger king', 'burgerking'],
        bg: '#D62300',
        border: '#FBE122',
        svg: `<svg viewBox="0 0 24 24" fill="none" class="w-full h-full"><path d="M4 11C4 7 7.5 4 12 4C16.5 4 20 7 20 11H4Z" fill="#FBE122"/><path d="M4 14C4 18 7.5 21 12 21C16.5 21 20 18 20 14H4Z" fill="#FBE122"/><rect x="3" y="11.5" width="18" height="2" rx="1" fill="#D62300"/><rect x="5" y="12" width="14" height="1" fill="#502314"/></svg>`
    },
    chickfila: {
        id: 'chickfila',
        name: 'Chick-fil-A',
        keywords: ['chick-fil-a', 'chickfila', 'chick fil a'],
        bg: '#DD0031',
        border: '#FFFFFF',
        svg: `<svg viewBox="0 0 24 24" fill="none" class="w-full h-full"><circle cx="12" cy="12" r="9" fill="#DD0031"/><path d="M8 12C8 9.5 9.8 7.5 12.5 7.5C14.5 7.5 16 8.5 16.5 10L14.5 10.8C14.2 9.8 13.5 9.2 12.5 9.2C10.8 9.2 9.8 10.5 9.8 12C9.8 13.8 11 14.8 12.8 14.8C14 14.8 14.8 14.2 15.2 13.2L17 14C16.2 15.5 14.8 16.5 12.8 16.5C9.8 16.5 8 14.5 8 12Z" fill="#FFFFFF"/><circle cx="15.5" cy="8.5" r="1" fill="#FFFFFF"/></svg>`
    },
    dominos: {
        id: 'dominos',
        name: "Domino's Pizza",
        keywords: ['domino', 'dominos', "domino's", "domino's pizza"],
        bg: '#006491',
        border: '#E31837',
        svg: `<svg viewBox="0 0 24 24" fill="none" class="w-full h-full"><rect x="4" y="6" width="7.5" height="12" rx="1.5" fill="#E31837" transform="rotate(-20 7.75 12)"/><rect x="12.5" y="6" width="7.5" height="12" rx="1.5" fill="#006491" transform="rotate(-20 16.25 12)"/><circle cx="8" cy="10" r="1.2" fill="#FFFFFF"/><circle cx="15.5" cy="10" r="1.2" fill="#FFFFFF"/><circle cx="17.5" cy="14" r="1.2" fill="#FFFFFF"/></svg>`
    },
    pizzahut: {
        id: 'pizzahut',
        name: 'Pizza Hut',
        keywords: ['pizza hut', 'pizzahut'],
        bg: '#EE3124',
        border: '#00A859',
        svg: `<svg viewBox="0 0 24 24" fill="none" class="w-full h-full"><path d="M3 13C6 11 18 11 21 13L18 10C16 8 8 8 6 10L3 13Z" fill="#EE3124"/><path d="M6 14C9 13.5 15 13.5 18 14L20 16H4L6 14Z" fill="#FFC220"/><rect x="4" y="16.5" width="16" height="2" rx="1" fill="#00A859"/></svg>`
    },
    dunkin: {
        id: 'dunkin',
        name: "Dunkin'",
        keywords: ['dunkin', 'dunkin donuts', "dunkin' donuts", "dunkin'"],
        bg: '#FF671F',
        border: '#DA1884',
        svg: `<svg viewBox="0 0 24 24" fill="none" class="w-full h-full"><circle cx="12" cy="12" r="9" fill="#FFFFFF"/><text x="6" y="16" font-size="11" font-weight="900" fill="#FF671F" font-family="Arial, sans-serif">D</text><text x="13" y="16" font-size="11" font-weight="900" fill="#DA1884" font-family="Arial, sans-serif">D</text></svg>`
    },

    // --- Major National Retailers ---
    target: {
        id: 'target',
        name: 'Target',
        keywords: ['target', 'target store'],
        bg: '#CC0000',
        border: '#FFFFFF',
        svg: `<svg viewBox="0 0 24 24" fill="none" class="w-full h-full"><circle cx="12" cy="12" r="9" fill="#CC0000"/><circle cx="12" cy="12" r="6" fill="#FFFFFF"/><circle cx="12" cy="12" r="3" fill="#CC0000"/></svg>`
    },
    walmart: {
        id: 'walmart',
        name: 'Walmart',
        keywords: ['walmart', 'wal-mart', 'walmart supercenter'],
        bg: '#0071DC',
        border: '#FFC220',
        svg: `<svg viewBox="0 0 24 24" fill="none" class="w-full h-full"><circle cx="12" cy="12" r="9.5" fill="#0071DC"/><path d="M12 4.5V8.5M12 15.5V19.5M4.5 12H8.5M15.5 12H19.5M6.7 6.7L9.5 9.5M14.5 14.5L17.3 17.3M17.3 6.7L14.5 9.5M9.5 14.5L6.7 17.3" stroke="#FFC220" stroke-width="2.2" stroke-linecap="round"/></svg>`
    },
    costco: {
        id: 'costco',
        name: 'Costco Wholesale',
        keywords: ['costco', 'costco wholesale'],
        bg: '#E31837',
        border: '#005DAA',
        svg: `<svg viewBox="0 0 24 24" fill="none" class="w-full h-full"><rect x="3" y="5" width="18" height="14" rx="3" fill="#005DAA"/><text x="5" y="15.5" font-size="10" font-weight="900" fill="#E31837" font-style="italic" font-family="Arial Black, sans-serif">C</text><text x="12" y="15.5" font-size="7" font-weight="900" fill="#FFFFFF" font-family="Arial, sans-serif">OSTCO</text></svg>`
    },
    homedepot: {
        id: 'homedepot',
        name: 'The Home Depot',
        keywords: ['home depot', 'the home depot', 'homedepot'],
        bg: '#F96302',
        border: '#FFFFFF',
        svg: `<svg viewBox="0 0 24 24" fill="none" class="w-full h-full"><rect x="4" y="4" width="16" height="16" rx="2" fill="#F96302"/><text x="6" y="12" font-size="5" font-weight="900" fill="#FFFFFF" font-family="Arial Black, sans-serif">THE</text><text x="5" y="17" font-size="5" font-weight="900" fill="#FFFFFF" font-family="Arial Black, sans-serif">HOME</text></svg>`
    },
    lowes: {
        id: 'lowes',
        name: "Lowe's",
        keywords: ['lowes', "lowe's", "lowe's home improvement"],
        bg: '#004990',
        border: '#FFFFFF',
        svg: `<svg viewBox="0 0 24 24" fill="none" class="w-full h-full"><path d="M4 8L12 4L20 8V19H4V8Z" fill="#004990"/><text x="5.5" y="15" font-size="7" font-weight="900" fill="#FFFFFF" font-family="Arial Black, sans-serif">LOWE'S</text></svg>`
    },
    bestbuy: {
        id: 'bestbuy',
        name: 'Best Buy',
        keywords: ['best buy', 'bestbuy'],
        bg: '#0046BE',
        border: '#FFE600',
        svg: `<svg viewBox="0 0 24 24" fill="none" class="w-full h-full"><rect x="4" y="5" width="16" height="14" rx="2" fill="#0046BE"/><path d="M15 6L19 10L14 15L10 11L15 6Z" fill="#FFE600"/><circle cx="16" cy="9" r="1" fill="#000000"/></svg>`
    },

    // --- Major Gas Stations ---
    shell: {
        id: 'shell',
        name: 'Shell',
        keywords: ['shell', 'shell gas', 'shell oil'],
        bg: '#DD1D21',
        border: '#FFD100',
        svg: `<svg viewBox="0 0 24 24" fill="none" class="w-full h-full"><path d="M12 4C8 4 5 7 5 11C5 15 8 18 10 19.5L12 20.5L14 19.5C16 18 19 15 19 11C19 7 16 4 12 4Z" fill="#FFD100" stroke="#DD1D21" stroke-width="1.2"/><path d="M12 6V18M8.5 8L11 18M15.5 8L13 18" stroke="#DD1D21" stroke-width="1.2"/></svg>`
    },
    chevron: {
        id: 'chevron',
        name: 'Chevron',
        keywords: ['chevron', 'chevron gas'],
        bg: '#005DAB',
        border: '#DA291C',
        svg: `<svg viewBox="0 0 24 24" fill="none" class="w-full h-full"><path d="M5 6L12 11L19 6L17 4L12 8L7 4L5 6Z" fill="#005DAB"/><path d="M5 12L12 17L19 12L17 10L12 14L7 10L5 12Z" fill="#DA291C"/></svg>`
    },
    exxon: {
        id: 'exxon',
        name: 'Exxon / Mobil',
        keywords: ['exxon', 'mobil', 'exxonmobil'],
        bg: '#EE1C25',
        border: '#003366',
        svg: `<svg viewBox="0 0 24 24" fill="none" class="w-full h-full"><rect x="3" y="5" width="18" height="14" rx="3" fill="#FFFFFF" stroke="#EE1C25" stroke-width="1.5"/><text x="4.5" y="16" font-size="9" font-weight="900" fill="#EE1C25" font-family="Arial Black, sans-serif">EXXON</text></svg>`
    },
    bp: {
        id: 'bp',
        name: 'BP',
        keywords: ['bp', 'bp gas', 'british petroleum'],
        bg: '#00853F',
        border: '#FEEB00',
        svg: `<svg viewBox="0 0 24 24" fill="none" class="w-full h-full"><circle cx="12" cy="12" r="9" fill="#00853F"/><circle cx="12" cy="12" r="6" fill="#FEEB00"/><circle cx="12" cy="12" r="3" fill="#FFFFFF"/></svg>`
    },
    speedway: {
        id: 'speedway',
        name: 'Speedway',
        keywords: ['speedway', 'speedway gas'],
        bg: '#ED1C24',
        border: '#FFFFFF',
        svg: `<svg viewBox="0 0 24 24" fill="none" class="w-full h-full"><circle cx="12" cy="12" r="9" fill="#ED1C24"/><text x="8" y="16" font-size="12" font-weight="900" font-style="italic" fill="#FFFFFF" font-family="Arial Black, sans-serif">S</text></svg>`
    },
    circlek: {
        id: 'circlek',
        name: 'Circle K',
        keywords: ['circle k', 'circlek', 'kangaroo express'],
        bg: '#D41F26',
        border: '#E87722',
        svg: `<svg viewBox="0 0 24 24" fill="none" class="w-full h-full"><circle cx="12" cy="12" r="9" fill="#D41F26"/><circle cx="12" cy="12" r="7" stroke="#E87722" stroke-width="1.5"/><text x="8" y="16.5" font-size="12" font-weight="900" fill="#FFFFFF" font-family="Arial Black, sans-serif">K</text></svg>`
    },
    seveneleven: {
        id: 'seveneleven',
        name: '7-Eleven',
        keywords: ['7-eleven', '7 eleven', '7eleven'],
        bg: '#008060',
        border: '#F37021',
        svg: `<svg viewBox="0 0 24 24" fill="none" class="w-full h-full"><rect x="4" y="4" width="16" height="16" rx="3" fill="#FFFFFF"/><path d="M6 7H14V9L9 17H6.5L11 9H6V7Z" fill="#F37021"/><rect x="13.5" y="7" width="4" height="10" rx="1" fill="#008060"/></svg>`
    },
    wawa: {
        id: 'wawa',
        name: 'Wawa',
        keywords: ['wawa'],
        bg: '#C8102E',
        border: '#FFD100',
        svg: `<svg viewBox="0 0 24 24" fill="none" class="w-full h-full"><circle cx="12" cy="12" r="9.5" fill="#C8102E"/><path d="M5 14C8 10 13 8 19 8C17 11 14 13 11 15C8 17 6 16 5 14Z" fill="#FFD100"/></svg>`
    },

    // --- Pharmacies & Banks ---
    cvs: {
        id: 'cvs',
        name: 'CVS Pharmacy',
        keywords: ['cvs', 'cvs pharmacy', 'cvs/pharmacy'],
        bg: '#CC0000',
        border: '#FFFFFF',
        svg: `<svg viewBox="0 0 24 24" fill="none" class="w-full h-full"><rect x="3" y="6" width="18" height="12" rx="3" fill="#CC0000"/><text x="4.5" y="15" font-size="8" font-weight="900" fill="#FFFFFF" font-family="Arial Black, sans-serif">CVS</text></svg>`
    },
    walgreens: {
        id: 'walgreens',
        name: 'Walgreens',
        keywords: ['walgreens', 'walgreen'],
        bg: '#E31837',
        border: '#FFFFFF',
        svg: `<svg viewBox="0 0 24 24" fill="none" class="w-full h-full"><circle cx="12" cy="12" r="9.5" fill="#E31837"/><text x="6" y="16.5" font-size="14" font-style="italic" font-weight="bold" fill="#FFFFFF" font-family="Georgia, serif">W</text></svg>`
    },
    chase: {
        id: 'chase',
        name: 'Chase Bank',
        keywords: ['chase', 'chase bank', 'jpmorgan chase'],
        bg: '#117ACA',
        border: '#FFFFFF',
        svg: `<svg viewBox="0 0 24 24" fill="none" class="w-full h-full"><rect x="4" y="4" width="16" height="16" rx="3" fill="#117ACA"/><rect x="8" y="8" width="8" height="8" fill="#FFFFFF"/><rect x="10" y="10" width="4" height="4" fill="#117ACA"/></svg>`
    },
    bankofamerica: {
        id: 'bankofamerica',
        name: 'Bank of America',
        keywords: ['bank of america', 'boa', 'bofa'],
        bg: '#012169',
        border: '#E31837',
        svg: `<svg viewBox="0 0 24 24" fill="none" class="w-full h-full"><rect x="3" y="5" width="18" height="14" rx="2" fill="#012169"/><rect x="6" y="8" width="4" height="8" fill="#E31837"/><rect x="11" y="8" width="7" height="8" fill="#E31837"/></svg>`
    }
};

/**
 * Finds matching brand metadata for a given place name or query
 */
export function getBrandMeta(placeNameOrQuery?: string): BrandMeta | null {
    if (!placeNameOrQuery) return null;
    const clean = placeNameOrQuery.toLowerCase().replace(/['s]/g, '').trim();

    for (const brand of Object.values(BRAND_REGISTRY)) {
        for (const kw of brand.keywords) {
            const cleanKw = kw.toLowerCase().replace(/['s]/g, '').trim();
            if (clean.includes(cleanKw) || cleanKw.includes(clean)) {
                return brand;
            }
        }
    }
    return null;
}
