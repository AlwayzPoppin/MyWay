import { ref, set, onValue, off, serverTimestamp } from 'firebase/database';
import { database } from './firebase';
import { BleClient } from '@capacitor-community/bluetooth-le';
import { Capacitor } from '@capacitor/core';

/**
 * Cloud Relay Service (Mesh Simulation)
 * 
 * NOTE: This service currently simulates a P2P Mesh network using Firebase Realtime Database
 * as a relay server. It demonstrates the "Dead-Zone" hopping logic without requiring
 * physical Bluetooth LE hardware during the web-prototype phase.
 * 
 * Roadmap: Hybrid implementation using `capacitor-bluetooth-le` for native offline connectivity.
 */

export interface MeshNode {
    id: string;
    lastHeartbeat: number;
    relayCount: number;
    hops: number;
    rssi: number; // Signal strength simulation
    source: 'cloud' | 'ble';
}

const MESH_SERVICE_UUID = '00001803-0000-1000-8000-00805f9b34fb'; // Custom MyWay Mesh UUID

/**
 * Encodes location and TTL into a compact 12-byte buffer for BLE Advertising
 * Format: [Lat (4 bytes), Lng (4 bytes), TTL (1 byte), Padding (3 bytes)]
 */
const encodeLocationToBlePacket = (location: { lat: number, lng: number }, ttl: number): Uint8Array => {
    const buffer = new ArrayBuffer(12);
    const view = new DataView(buffer);
    view.setFloat32(0, location.lat, true);
    view.setFloat32(4, location.lng, true);
    view.setUint8(8, ttl);
    return new Uint8Array(buffer);
};

const decodeBlePacketToLocation = (data: DataView): { lat: number, lng: number, ttl: number } => {
    return {
        lat: data.getFloat32(0, true),
        lng: data.getFloat32(4, true),
        ttl: data.getUint8(8)
    };
};

export const startMeshHeartbeat = (circleId: string, userId: string, location: { lat: number, lng: number }) => {
    const meshRef = ref(database, `mesh/${circleId}/${userId}`);

    // 1. Cloud Heartbeat (Firebase)
    const sendCloudHeartbeat = () => {
        set(meshRef, {
            senderId: userId,
            location,
            timestamp: serverTimestamp(),
            ttl: 3,
            hops: 0
        }).catch(err => console.debug("[Mesh] Cloud heartbeat skipped", err));
    };

    const cloudInterval = setInterval(sendCloudHeartbeat, 5000);

    // 2. BLE Heartbeat (Native Advertising)
    const startBleAdvertising = async () => {
        if (!Capacitor.isNativePlatform()) return;
        try {
            await BleClient.initialize();

            // Architecture Placeholder for Native P2P Mesh
            const packet = encodeLocationToBlePacket(location, 3);
            console.log('[Mesh] Prepared BLE Advertisement packet:', packet);

            // Note: Standard BleClient is primarily Central. 
            // In a native iOS/Android bridge, this would call PeripheralManager.startAdvertising()
            // encoding the location in the 'Service Data' or 'Manufacturer Data' field.
            console.log('[Mesh] BLE Advertising service initialized [Architecture Only]');
        } catch (e) {
            console.warn('[Mesh] BLE Init failed:', e);
        }
    };
    startBleAdvertising();

    return () => clearInterval(cloudInterval);
};

export const subscribeToMesh = (
    circleId: string,
    userId: string,
    currentLoc: { lat: number, lng: number },
    callback: (node: MeshNode & { location: any }) => void
) => {
    const cleanups: (() => void)[] = [];

    // 1. Cloud Subscription
    const meshRef = ref(database, `mesh/${circleId}`);

    const firebaseCallback = onValue(meshRef, (snapshot) => {
        if (!snapshot.exists()) return;
        const nodes = snapshot.val();

        Object.keys(nodes).forEach(nodeId => {
            if (nodeId === userId) return; // Skip self

            const nodeData = nodes[nodeId];
            if (!nodeData.location) return;
            const { lat, lng } = nodeData.location;

            // Calculate simulated distance and RSSI
            const dist = Math.sqrt(Math.pow(lat - currentLoc.lat, 2) + Math.pow(lng - currentLoc.lng, 2));
            const simulatedRssi = Math.floor(-50 - (dist * 10000)); // Rough attenuation model

            callback({
                id: nodeId,
                lastHeartbeat: nodeData.timestamp || Date.now(),
                relayCount: 0,
                hops: nodeData.hops,
                rssi: Math.max(-100, simulatedRssi),
                source: 'cloud',
                location: nodeData.location
            });
        });
    });
    cleanups.push(() => off(meshRef, 'value', firebaseCallback));

    // 2. BLE Scanning (Central Role - Native Only)
    const startBleScanning = async () => {
        if (!Capacitor.isNativePlatform()) return;
        try {
            await BleClient.initialize();
            await BleClient.requestLEScan(
                {
                    services: [MESH_SERVICE_UUID],
                    allowDuplicates: true,
                    scanMode: 'lowLatency'
                },
                (result) => {
                    // Real P2P Packet Handling
                    // In a full implementation, we decode `result.manufacturerData` here
                    // using decodeBlePacketToLocation(view)
                    console.debug('[Mesh] BLE Packet received:', result.device.name, result.rssi);

                    // For now, we acknowledge presence
                    // callback({ ... decoded node from BLE ... })
                }
            );
        } catch (e) {
            console.warn('[Mesh] BLE Scan failed to start:', e);
        }
    };

    startBleScanning();
    cleanups.push(() => {
        if (Capacitor.isNativePlatform()) BleClient.stopLEScan().catch(() => { });
    });

    // 2. BLE Scanning (Offline Mesh)
    const startBleScan = async () => {
        if (!Capacitor.isNativePlatform()) return;
        try {
            await BleClient.initialize();
            await BleClient.requestLEScan(
                { services: [MESH_SERVICE_UUID], allowDuplicates: true },
                (result) => {
                    // TODO: Parse serviceData for offline location encoded in advertisement
                    console.log('[Mesh] BLE Packet received:', result.device.deviceId, result.rssi);
                }
            );
        } catch (e) {
            console.warn('[Mesh] BLE Scan failed:', e);
        }
    };
    startBleScan();
    cleanups.push(() => { if (Capacitor.isNativePlatform()) BleClient.stopLEScan().catch(() => { }); });

    return () => cleanups.forEach(fn => fn());
};
