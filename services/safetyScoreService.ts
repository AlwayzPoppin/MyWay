/**
 * Safety Score & Family Driving Leaderboard Service
 * 
 * Computes:
 * 1. Driving Safety Scores (0-100) based on smooth braking, acceleration, and speed adherence.
 * 2. Weekly Family Driving Leaderboard & Rankings.
 * 3. Weekly Safety Badges & Awards:
 *    - 🌟 Smooth Operator (Zero or lowest hard brakes)
 *    - ⚡ Road Warrior (Most miles navigated)
 *    - 🔋 Eco Cruiser (Best battery & fuel efficiency rating)
 *    - 🛡️ Defensive Master (95%+ overall safety score)
 *    - ⏱️ Pacing Prodigy (Zero speeding events)
 */

import { FamilyMember, Trip } from '../types';
import { getSavedTrips } from './tripHistoryService';

export interface SafetyBadge {
    id: 'smooth_operator' | 'road_warrior' | 'eco_cruiser' | 'defensive_master' | 'pacing_prodigy';
    title: string;
    icon: string;
    color: string;
    accentHex: string;
    tagline: string;
    description: string;
    winnerId?: string;
    winnerName?: string;
    winnerAvatar?: string;
    metricLabel?: string;
    metricValue?: string;
}

export interface MemberDrivingStats {
    memberId: string;
    name: string;
    avatar: string;
    role: string;
    safetyScore: number;
    totalMiles: number;
    totalTrips: number;
    driveMinutes: number;
    hardBrakes: number;
    rapidAccels: number;
    speedingEvents: number;
    ecoScore: number; // 0-100%
    rank: number;
    badges: SafetyBadge[];
    trend: 'improving' | 'stable' | 'declining';
}

export interface FamilyLeaderboard {
    circleId: string;
    circleName: string;
    weekRange: string;
    totalGroupMiles: number;
    avgGroupScore: number;
    members: MemberDrivingStats[];
    featuredAwards: SafetyBadge[];
}

export const SAFETY_BADGE_DEFINITIONS: Record<string, Omit<SafetyBadge, 'winnerId' | 'winnerName' | 'winnerAvatar' | 'metricLabel' | 'metricValue'>> = {
    smooth_operator: {
        id: 'smooth_operator',
        title: 'Smooth Operator',
        icon: '🌟',
        color: 'emerald',
        accentHex: '#10B981',
        tagline: 'Zero Hard Braking Events',
        description: 'Demonstrated superior vehicle control with velvet-smooth braking throughout the entire week.'
    },
    road_warrior: {
        id: 'road_warrior',
        title: 'Road Warrior',
        icon: '⚡',
        color: 'amber',
        accentHex: '#F59E0B',
        tagline: 'Most Miles Navigated',
        description: 'Logged the highest total travel distance while maintaining high safety awareness.'
    },
    eco_cruiser: {
        id: 'eco_cruiser',
        title: 'Eco Cruiser',
        icon: '🔋',
        color: 'cyan',
        accentHex: '#06B6D4',
        tagline: 'Optimal Fuel & Energy Efficiency',
        description: 'Maximized energy regeneration and fuel savings through progressive throttle management.'
    },
    defensive_master: {
        id: 'defensive_master',
        title: 'Defensive Master',
        icon: '🛡️',
        color: 'indigo',
        accentHex: '#6366F1',
        tagline: 'Elite 95+ Safety Score',
        description: 'Maintained top-tier spatial awareness, safe following distance, and speed compliance.'
    },
    pacing_prodigy: {
        id: 'pacing_prodigy',
        title: 'Pacing Prodigy',
        icon: '⏱️',
        color: 'purple',
        accentHex: '#A855F7',
        tagline: 'Zero Speeding Violations',
        description: 'Perfect adherence to posted road speed limits across city and highway corridors.'
    }
};

/**
 * Deterministic generator for member driving metrics based on member ID
 * Used when remote member trip logs are synced or simulated for solo testing
 */
const generateDeterministicMemberStats = (member: FamilyMember, seed: number): Omit<MemberDrivingStats, 'rank' | 'badges'> => {
    // Generate realistic variance between 84 and 99
    const pseudoRand = (str: string) => {
        let h = 0;
        for (let i = 0; i < str.length; i++) h = (h << 5) - h + str.charCodeAt(i);
        return Math.abs(h % 1000) / 1000;
    };

    const r1 = pseudoRand(`${member.id}_miles_${seed}`);
    const r2 = pseudoRand(`${member.id}_score_${seed}`);
    const r3 = pseudoRand(`${member.id}_trips_${seed}`);

    const totalMiles = Math.round((18 + r1 * 95) * 10) / 10;
    const totalTrips = Math.floor(4 + r3 * 16);
    const safetyScore = member.safetyScore && member.safetyScore > 0 
        ? member.safetyScore 
        : Math.round(86 + r2 * 13);
    const hardBrakes = safetyScore >= 95 ? 0 : Math.floor((100 - safetyScore) / 4);
    const rapidAccels = Math.floor((100 - safetyScore) / 6);
    const speedingEvents = safetyScore >= 92 ? 0 : 1;
    const ecoScore = Math.min(100, Math.round(safetyScore * 0.95 + r1 * 5));
    const driveMinutes = Math.round(totalMiles * 1.9);

    return {
        memberId: member.id,
        name: member.name || 'Member',
        avatar: member.avatar || '',
        role: member.role || 'Member',
        safetyScore,
        totalMiles,
        totalTrips,
        driveMinutes,
        hardBrakes,
        rapidAccels,
        speedingEvents,
        ecoScore,
        trend: safetyScore >= 94 ? 'improving' : safetyScore >= 88 ? 'stable' : 'declining'
    };
};

/**
 * Calculates the complete weekly leaderboard and assigns badges
 */
export const calculateFamilyLeaderboard = (
    members: FamilyMember[],
    currentUserId?: string,
    circleName: string = 'Family Circle'
): FamilyLeaderboard => {
    const now = Date.now();
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
    const userTrips = getSavedTrips().filter(t => t.startTime >= weekAgo);

    // 1. Calculate stats for the current user from real trip history
    let selfStats: Omit<MemberDrivingStats, 'rank' | 'badges'>;
    const selfMember = members.find(m => m.id === currentUserId || m.id === 'demo-you' || m.id === 'current_user');

    if (userTrips.length > 0) {
        const totalMiles = Math.round(userTrips.reduce((sum, t) => sum + t.totalDistanceMiles, 0) * 10) / 10;
        const totalDriveMs = userTrips.reduce((sum, t) => sum + ((t.endTime || t.startTime) - t.startTime), 0);
        const avgScore = Math.round(userTrips.reduce((sum, t) => sum + t.safetyScore, 0) / userTrips.length);

        let hardBrakes = 0;
        let rapidAccels = 0;
        let speedingEvents = 0;

        userTrips.forEach(t => {
            t.driveEvents.forEach(e => {
                if (e.type === 'hard_brake') hardBrakes++;
                if (e.type === 'rapid_accel') rapidAccels++;
                if (e.type === 'speeding') speedingEvents++;
            });
        });

        const ecoScore = Math.min(100, Math.max(70, Math.round(avgScore * 0.96 - rapidAccels * 2)));

        selfStats = {
            memberId: currentUserId || 'current_user',
            name: selfMember?.name || 'You',
            avatar: selfMember?.avatar || '',
            role: selfMember?.role || 'Primary',
            safetyScore: avgScore,
            totalMiles,
            totalTrips: userTrips.length,
            driveMinutes: Math.floor(totalDriveMs / 60000),
            hardBrakes,
            rapidAccels,
            speedingEvents,
            ecoScore,
            trend: avgScore >= 90 ? 'improving' : 'stable'
        };
    } else {
        // Fallback if user has not completed trips yet this week
        selfStats = {
            memberId: currentUserId || 'current_user',
            name: selfMember?.name || 'You',
            avatar: selfMember?.avatar || '',
            role: selfMember?.role || 'Primary',
            safetyScore: 98,
            totalMiles: 42.6,
            totalTrips: 8,
            driveMinutes: 68,
            hardBrakes: 0,
            rapidAccels: 1,
            speedingEvents: 0,
            ecoScore: 96,
            trend: 'improving'
        };
    }

    // 2. Aggregate stats for all members in circle
    const allMemberStats: Array<Omit<MemberDrivingStats, 'rank' | 'badges'>> = [];
    const processedIds = new Set<string>();

    // Add self
    allMemberStats.push(selfStats);
    processedIds.add(selfStats.memberId);
    if (currentUserId) processedIds.add(currentUserId);
    processedIds.add('demo-you');
    processedIds.add('current_user');

    // Add other circle members
    members.forEach((m, idx) => {
        if (!processedIds.has(m.id)) {
            processedIds.add(m.id);
            allMemberStats.push(generateDeterministicMemberStats(m, idx + 101));
        }
    });

    // 3. Sort by Safety Score descending (Tie-breaker: totalMiles)
    allMemberStats.sort((a, b) => {
        if (b.safetyScore !== a.safetyScore) {
            return b.safetyScore - a.safetyScore;
        }
        return b.totalMiles - a.totalMiles;
    });

    // 4. Award Badges
    // Find winners for each category
    let smoothOperatorWinner = allMemberStats[0];
    let minBrakes = Infinity;
    allMemberStats.forEach(m => {
        if (m.hardBrakes < minBrakes) {
            minBrakes = m.hardBrakes;
            smoothOperatorWinner = m;
        }
    });

    let roadWarriorWinner = allMemberStats[0];
    let maxMiles = -1;
    allMemberStats.forEach(m => {
        if (m.totalMiles > maxMiles) {
            maxMiles = m.totalMiles;
            roadWarriorWinner = m;
        }
    });

    let ecoCruiserWinner = allMemberStats[0];
    let maxEco = -1;
    allMemberStats.forEach(m => {
        if (m.ecoScore > maxEco) {
            maxEco = m.ecoScore;
            ecoCruiserWinner = m;
        }
    });

    const finalMembers: MemberDrivingStats[] = allMemberStats.map((m, index) => {
        const memberBadges: SafetyBadge[] = [];

        if (m.memberId === smoothOperatorWinner.memberId && m.hardBrakes === 0) {
            memberBadges.push({
                ...SAFETY_BADGE_DEFINITIONS.smooth_operator,
                winnerId: m.memberId,
                winnerName: m.name,
                winnerAvatar: m.avatar,
                metricLabel: 'Hard Brakes',
                metricValue: '0 Events 🌟'
            });
        }

        if (m.memberId === roadWarriorWinner.memberId) {
            memberBadges.push({
                ...SAFETY_BADGE_DEFINITIONS.road_warrior,
                winnerId: m.memberId,
                winnerName: m.name,
                winnerAvatar: m.avatar,
                metricLabel: 'Total Distance',
                metricValue: `${m.totalMiles} mi`
            });
        }

        if (m.memberId === ecoCruiserWinner.memberId) {
            memberBadges.push({
                ...SAFETY_BADGE_DEFINITIONS.eco_cruiser,
                winnerId: m.memberId,
                winnerName: m.name,
                winnerAvatar: m.avatar,
                metricLabel: 'Eco Rating',
                metricValue: `${m.ecoScore}% Efficiency`
            });
        }

        if (m.safetyScore >= 95) {
            memberBadges.push({
                ...SAFETY_BADGE_DEFINITIONS.defensive_master,
                winnerId: m.memberId,
                winnerName: m.name,
                winnerAvatar: m.avatar,
                metricLabel: 'Safety Rating',
                metricValue: `${m.safetyScore}% Score`
            });
        }

        if (m.speedingEvents === 0) {
            memberBadges.push({
                ...SAFETY_BADGE_DEFINITIONS.pacing_prodigy,
                winnerId: m.memberId,
                winnerName: m.name,
                winnerAvatar: m.avatar,
                metricLabel: 'Speeding',
                metricValue: '0 Violations'
            });
        }

        return {
            ...m,
            rank: index + 1,
            badges: memberBadges
        };
    });

    // 5. Featured Circle Awards
    const featuredAwards: SafetyBadge[] = [
        {
            ...SAFETY_BADGE_DEFINITIONS.smooth_operator,
            winnerId: smoothOperatorWinner.memberId,
            winnerName: smoothOperatorWinner.name,
            winnerAvatar: smoothOperatorWinner.avatar,
            metricLabel: 'Hard Brakes',
            metricValue: `${smoothOperatorWinner.hardBrakes} Events`
        },
        {
            ...SAFETY_BADGE_DEFINITIONS.road_warrior,
            winnerId: roadWarriorWinner.memberId,
            winnerName: roadWarriorWinner.name,
            winnerAvatar: roadWarriorWinner.avatar,
            metricLabel: 'Miles Driven',
            metricValue: `${roadWarriorWinner.totalMiles} mi`
        },
        {
            ...SAFETY_BADGE_DEFINITIONS.eco_cruiser,
            winnerId: ecoCruiserWinner.memberId,
            winnerName: ecoCruiserWinner.name,
            winnerAvatar: ecoCruiserWinner.avatar,
            metricLabel: 'Efficiency',
            metricValue: `${ecoCruiserWinner.ecoScore}%`
        }
    ];

    const totalGroupMiles = Math.round(finalMembers.reduce((sum, m) => sum + m.totalMiles, 0) * 10) / 10;
    const avgGroupScore = Math.round(finalMembers.reduce((sum, m) => sum + m.safetyScore, 0) / (finalMembers.length || 1));

    // Formatted date range (e.g., "Aug 25 – Sep 1")
    const d1 = new Date(weekAgo);
    const d2 = new Date(now);
    const weekRange = `${d1.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${d2.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;

    return {
        circleId: 'active_circle',
        circleName,
        weekRange,
        totalGroupMiles,
        avgGroupScore,
        members: finalMembers,
        featuredAwards
    };
};
