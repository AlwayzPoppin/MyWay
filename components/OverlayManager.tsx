
import React from 'react';
import { createPortal } from 'react-dom';

interface OverlayManagerProps {
    children: React.ReactNode;
    id?: string;
    className?: string;
}

/**
 * OverlayManager uses React Portals to render children outside the main 
 * component hierarchy. This resolves stacking context issues (z-index) 
 * between the Leaflet Map and complex UI elements like AI HUDs.
 */
const OverlayManager: React.FC<OverlayManagerProps> = ({ children, id = 'myway-portal-root', className = '' }) => {
    // Ensure the portal root exists in the DOM
    let portalRoot = document.getElementById(id);

    if (!portalRoot) {
        portalRoot = document.createElement('div');
        portalRoot.id = id;
        portalRoot.className = `fixed inset-0 pointer-events-none z-[999] ${className}`;
        document.body.appendChild(portalRoot);
    }

    return createPortal(
        <div className="pointer-events-auto contents">
            {children}
        </div>,
        portalRoot
    );
};

export default OverlayManager;
