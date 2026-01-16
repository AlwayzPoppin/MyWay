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
        name: 'Gold Monthly',
        priceId: 'price_gold_monthly',
        price: 4.99,
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
    gold_annual: {
        id: 'gold_annual',
        name: 'Gold Annual',
        priceId: 'price_gold_annual',
        price: 39.99,
        currency: 'USD',
        interval: 'year',
        description: 'Save 33% with our annual family plan.',
        badge: '🏆 GOLD ANNUAL',
        color: 'from-amber-400 to-orange-500',
        features: [
            'Basic Gold features',
            'Priority support',
            'Early access to new features'
        ]
    },
    platinum: {
        id: 'platinum',
        name: 'Platinum Plus Monthly',
        priceId: 'price_platinum_monthly',
        price: 9.99,
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
    },
    platinum_annual: {
        id: 'platinum_annual',
        name: 'Platinum Plus Annual',
        priceId: 'price_platinum_annual',
        price: 79.99,
        currency: 'USD',
        interval: 'year',
        description: 'Best value for maximum protection. Save 33%.',
        badge: '💎 PLATINUM ANNUAL',
        color: 'from-indigo-400 to-purple-600',
        features: [
            'All Platinum features',
            'Family safety consult',
            'VIP roadside priority'
        ]
    }
};
