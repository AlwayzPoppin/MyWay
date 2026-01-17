import { db, auth, functions } from './firebase';
import { collection, addDoc, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';

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
    const user = auth.currentUser;
    if (!user) throw new Error('User must be logged in');

    try {
        // Use the Firebase Stripe extension's portal link function
        const createPortalLink = httpsCallable<
            { returnUrl: string },
            { url: string }
        >(functions, 'ext-firestore-stripe-payments-createPortalLink');

        const { data } = await createPortalLink({
            returnUrl: window.location.origin
        });

        window.location.href = data.url;
    } catch (error: any) {
        console.error('Billing portal error:', error);
        throw new Error('Failed to open billing portal. Please try again.');
    }
};

