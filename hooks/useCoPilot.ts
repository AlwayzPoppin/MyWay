import { useState, useEffect, useRef } from 'react';
import { getSafetyAdvisory, SafetyAdvisory } from '../services/geminiService';
import { audioService } from '../services/audioService';
import { FamilyMember } from '../types';

export const useCoPilot = (
    user: any,
    isNavigating: boolean,
    members: FamilyMember[]
) => {
    const [activeAdvisory, setActiveAdvisory] = useState<SafetyAdvisory | null>(null);
    const membersRef = useRef(members);

    useEffect(() => {
        membersRef.current = members;
    }, [members]);

    useEffect(() => {
        if (!isNavigating || !user) {
            setActiveAdvisory(null);
            return;
        }

        const checkSafety = async () => {
            const member = membersRef.current.find(m => m.id === user.uid);
            if (member?.location) {
                const advisory = await getSafetyAdvisory(member.location);
                if (advisory && advisory.title !== activeAdvisory?.title) {
                    setActiveAdvisory(advisory);
                    // Verbal briefing for safety
                    audioService.speak(`Safety Alert: ${advisory.title}. ${advisory.description}`);
                }
            }
        };

        checkSafety();
        const interval = setInterval(checkSafety, 300000); // Check every 5 minutes
        return () => clearInterval(interval);
    }, [isNavigating, user?.uid]);

    return { activeAdvisory };
};
