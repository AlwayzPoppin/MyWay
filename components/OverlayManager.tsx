
import React, { createContext, useContext, useState, useCallback, useEffect, useId } from 'react';
import { createPortal } from 'react-dom';

// Priority stack context — tracks active overlays and dismisses lower-priority ones
interface OverlayEntry {
    id: string;
    priority: number;
}

interface OverlayStackContextType {
    register: (id: string, priority: number) => void;
    unregister: (id: string) => void;
    isActive: (id: string) => boolean;
}

const OverlayStackContext = createContext<OverlayStackContextType>({
    register: () => {},
    unregister: () => {},
    isActive: () => true,
});

/**
 * Provider for the overlay priority stack.
 * Place at app root to enable priority-based overlay management.
 */
export const OverlayStackProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [stack, setStack] = useState<OverlayEntry[]>([]);

    const register = useCallback((id: string, priority: number) => {
        setStack(prev => {
            const filtered = prev.filter(e => e.id !== id);
            return [...filtered, { id, priority }].sort((a, b) => b.priority - a.priority);
        });
    }, []);

    const unregister = useCallback((id: string) => {
        setStack(prev => prev.filter(e => e.id !== id));
    }, []);

    const isActive = useCallback((id: string) => {
        if (stack.length === 0) return true;
        
        // AUDIT FIX: If a priority 10 (Emergency) overlay is active, hide everything else
        const hasCritical = stack.some(e => e.priority === 10);
        const entry = stack.find(e => e.id === id);
        if (hasCritical) return entry?.priority === 10;

        // AUDIT FIX: Overlay Collision (Priority Stack)
        // If a high-priority overlay (like Navigation, priority 8) is present,
        // and current is lower priority (like Co-Pilot, priority 5), hide it.
        const highestPriority = stack[0]?.priority || 0;
        if (highestPriority >= 8 && (entry?.priority || 0) < 8) {
            return false;
        }

        return stack[0]?.id === id || stack.findIndex(e => e.id === id) !== -1;
    }, [stack]);

    return (
        <OverlayStackContext.Provider value={{ register, unregister, isActive }}>
            {children}
        </OverlayStackContext.Provider>
    );
};

interface OverlayManagerProps {
    children: React.ReactNode;
    id?: string;
    className?: string;
    priority?: number; // 1-10, higher = more important
}

/**
 * OverlayManager uses React Portals to render children outside the main 
 * component hierarchy. This resolves stacking context issues (z-index) 
 * between the Leaflet Map and complex UI elements like AI HUDs.
 * 
 * Priority prop (1-10) ensures higher-priority overlays stay on top.
 */
const OverlayManager: React.FC<OverlayManagerProps> = ({ children, id = 'myway-portal-root', className = '', priority = 5 }) => {
    const overlayId = useId();
    const { register, unregister, isActive } = useContext(OverlayStackContext);

    useEffect(() => {
        register(overlayId, priority);
        return () => unregister(overlayId);
    }, [overlayId, priority, register, unregister]);

    // Ensure the portal root exists in the DOM
    let portalRoot = document.getElementById(id);

    if (!portalRoot) {
        portalRoot = document.createElement('div');
        portalRoot.id = id;
        portalRoot.className = `fixed inset-0 pointer-events-none z-[999] ${className}`;
        document.body.appendChild(portalRoot);
    }

    const active = isActive(overlayId);

    return createPortal(
        <div className={`contents transition-all duration-300 ${active ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none scale-95'}`}>
            {children}
        </div>,
        portalRoot
    );
};

export default OverlayManager;
