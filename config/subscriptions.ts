// Subscription Products Configuration
export interface SubscriptionTier {
    id: string;
    name: string;
    priceId: string; // Stripe Price ID (from Stripe Dashboard)
    price: number;
    currency: string;
    interval: 'month' | 'year';
    description: string;
    features: string[];
    color: string;
    badge: string;
}

export const SUBSCRIPTION_TIERS: Record<string, SubscriptionTier> = {
    gold: {
        id: 'gold',
        name: 'Gold Membership',
        priceId: 'price_gold_monthly', // Placeholder - update with real Stripe Price ID
        price: 9.99,
        currency: 'USD',
        interval: 'month',
        description: 'Perfect for small families staying connected.',
        badge: '🏆 GOLD',
        color: 'from-amber-400 to-orange-500',
        features: [
            'Up to 5 family members',
            '30 days of location history',
            'Unlimited safety zones (geofence)',
            'Real-time speed alerts',
            'Priority safety shield'
        ]
    },
    platinum: {
        id: 'platinum',
        name: 'Platinum Plus',
        priceId: 'price_platinum_monthly', // Placeholder - update with real Stripe Price ID
        price: 19.99,
        currency: 'USD',
        interval: 'month',
        description: 'Ultimate safety and peace of mind for large families.',
        badge: '💎 PLATINUM',
        color: 'from-indigo-400 to-purple-600',
        features: [
            'Unlimited family members',
            '90 days of location history',
            'Unlimited safety zones+',
            'Driving safety reports',
            'Emergency roadside assistance',
            'Exclusive 3D map skins'
        ]
    }
};
