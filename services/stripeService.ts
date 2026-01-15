import { db, auth } from './firebase';
import { collection, addDoc, onSnapshot } from 'firebase/firestore';

export const createCheckoutSession = async (priceId: string) => {
    const user = auth.currentUser;
    if (!user) throw new Error('User must be logged in');

    const checkoutSessionRef = collection(db, 'customers', user.uid, 'checkout_sessions');
    const docRef = await addDoc(checkoutSessionRef, {
        price: priceId,
        success_url: window.location.origin,
        cancel_url: window.location.origin,
        mode: 'subscription', // Change to 'payment' for one-time payments
        allow_promotion_codes: true,
    });

    // Wait for the CheckoutSession to get attached by the extension
    return new Promise<string>((resolve, reject) => {
        const unsubscribe = onSnapshot(docRef, (snap) => {
            const data = snap.data();
            if (data) {
                const { error, url } = data;
                if (error) {
                    unsubscribe();
                    reject(new Error(`An error occurred: ${error.message}`));
                }
                if (url) {
                    unsubscribe();
                    resolve(url);
                }
            }
        });
    });
};

export const goToBillingPortal = async () => {
    // This requires the Stripe extension to be configured for a portal
    // Usually points to a function or a specific Firestore path if you want to create a portal session
    // For now, redirecting to a placeholder or handled via Firebase Functions if custom
    console.log('Redirecting to billing portal...');
};
