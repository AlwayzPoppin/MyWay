import { db } from './firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';

export interface EmailData {
    to: string | string[];
    message: {
        subject: string;
        text?: string;
        html?: string;
    };
    template?: {
        name: string;
        data: any;
    };
}

/**
 * Triggers an email sending process by writing a document to the 'mail' collection.
 * This document is picked up by the 'Trigger Email from Firestore' extension.
 */
export const sendEmail = async (email: EmailData): Promise<string> => {
    try {
        const docRef = await addDoc(collection(db, 'mail'), {
            ...email,
            delivery: {
                startTime: serverTimestamp(),
                state: 'PENDING'
            }
        });
        console.log('Email queued for delivery:', docRef.id);
        return docRef.id;
    } catch (error) {
        console.error('Error queuing email:', error);
        throw error;
    }
};

/**
 * Sends a welcome email to a new family member.
 */
export const sendWelcomeEmail = async (emailAddress: string, familyName: string) => {
    return sendEmail({
        to: emailAddress,
        message: {
            subject: `Welcome to the ${familyName} Family Circle on MyWay!`,
            html: `
        <h1>Welcome to MyWay!</h1>
        <p>You have been added to the <strong>${familyName}</strong> family circle.</p>
        <p>You can now share your location and stay connected with your family safely.</p>
        <br/>
        <p>Stay safe,<br/>The MyWay Team</p>
      `
        }
    });
};

/**
 * Sends an SOS alert to all family members.
 */
export const sendSOSAlert = async (recipients: string[], senderName: string, locationUrl: string) => {
    return sendEmail({
        to: recipients,
        message: {
            subject: `🚨 EMERGENCY: SOS Alert from ${senderName}`,
            html: `
        <h1 style="color: red;">Emergency Alert</h1>
        <p><strong>${senderName}</strong> has triggered an SOS alert!</p>
        <p>Their last known location: <a href="${locationUrl}">${locationUrl}</a></p>
        <br/>
        <p>Please check in on them immediately.</p>
      `
        }
    });
};

/**
 * Sends a geofence arrival notification.
 */
export const sendArrivalAlert = async (recipients: string[], memberName: string, placeName: string) => {
    return sendEmail({
        to: recipients,
        message: {
            subject: `🏠 Arrival Alert: ${memberName} has arrived at ${placeName}`,
            html: `
        <h1>Safe Arrival</h1>
        <p><strong>${memberName}</strong> has just arrived at <strong>${placeName}</strong>.</p>
        <p>Time: ${new Date().toLocaleTimeString()}</p>
        <br/>
        <p>MyWay Automated Alert</p>
      `
        }
    });
};

/**
 * Sends a geofence departure notification.
 */
export const sendDepartureAlert = async (recipients: string[], memberName: string, placeName: string) => {
    return sendEmail({
        to: recipients,
        message: {
            subject: `🚗 Departure Alert: ${memberName} has left ${placeName}`,
            html: `
        <h1>On the Move</h1>
        <p><strong>${memberName}</strong> has just left <strong>${placeName}</strong>.</p>
        <p>Time: ${new Date().toLocaleTimeString()}</p>
        <br/>
        <p>MyWay Automated Alert</p>
      `
        }
    });
};
