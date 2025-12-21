/**
 * RBAC Permissions System for SasWatch
 * 
 * Defines roles and permissions for multi-user accounts.
 * Roles are hierarchical: owner > admin > editor > viewer
 */

// Role hierarchy (higher index = more permissions)
const ROLE_HIERARCHY = ['viewer', 'editor', 'admin', 'owner'];

// Permission definitions by role
const ROLE_PERMISSIONS = {
    viewer: [
        'dashboard.view',
        'users.view',
        'apps.view',
        'licenses.view',
        'renewals.view',
        'activity.view',
    ],
    editor: [
        // Inherits viewer permissions
        'renewals.create',
        'renewals.edit',
        'renewals.delete',
        'users.edit',           // Edit tracked users (map usernames, etc.)
        'apps.edit',            // Edit app overrides
        'licenses.edit',        // Edit license costs
    ],
    admin: [
        // Inherits editor permissions
        'account.view',
        'account.edit',         // Edit account settings
        'members.view',
        'members.invite',
        'members.edit',         // Change member roles (except owner)
        'members.remove',       // Remove members (except owner)
        'integrations.manage',  // Connect Entra, etc.
        'agent.download',       // Download activity agent
    ],
    owner: [
        // Inherits admin permissions
        'account.delete',       // Delete entire account
        'billing.manage',       // Manage subscription tier
        'members.transfer',     // Transfer ownership
    ]
};

/**
 * Get all permissions for a role (including inherited permissions)
 * @param {string} role - Role name (owner, admin, editor, viewer)
 * @returns {string[]} Array of permission strings
 */
function getPermissionsForRole(role) {
    const roleIndex = ROLE_HIERARCHY.indexOf(role);
    if (roleIndex === -1) {
        return ROLE_PERMISSIONS.viewer; // Default to viewer if unknown role
    }

    // Collect permissions from this role and all lower roles
    const permissions = new Set();
    for (let i = 0; i <= roleIndex; i++) {
        const r = ROLE_HIERARCHY[i];
        if (ROLE_PERMISSIONS[r]) {
            ROLE_PERMISSIONS[r].forEach(p => permissions.add(p));
        }
    }
    
    return Array.from(permissions);
}

/**
 * Check if a role has a specific permission
 * @param {string} role - Role name
 * @param {string} permission - Permission to check
 * @returns {boolean}
 */
function hasPermission(role, permission) {
    const permissions = getPermissionsForRole(role);
    return permissions.includes(permission);
}

/**
 * Check if role1 is higher or equal to role2 in hierarchy
 * @param {string} role1 - First role
 * @param {string} role2 - Second role
 * @returns {boolean}
 */
function isRoleAtLeast(role1, role2) {
    const index1 = ROLE_HIERARCHY.indexOf(role1);
    const index2 = ROLE_HIERARCHY.indexOf(role2);
    
    if (index1 === -1 || index2 === -1) return false;
    return index1 >= index2;
}

/**
 * Check if a role can modify another role
 * Rules:
 * - owner can modify any role
 * - admin can modify editor and viewer
 * - nobody can modify owner except owner themselves
 * @param {string} actorRole - Role of the person making the change
 * @param {string} targetRole - Role being modified
 * @returns {boolean}
 */
function canModifyRole(actorRole, targetRole) {
    if (targetRole === 'owner') {
        return actorRole === 'owner'; // Only owner can modify owner
    }
    return isRoleAtLeast(actorRole, 'admin');
}

/**
 * Get roles that a given role can assign to others
 * @param {string} role - The assigner's role
 * @returns {string[]} Array of assignable roles
 */
function getAssignableRoles(role) {
    if (role === 'owner') {
        return ['viewer', 'editor', 'admin']; // Owner can assign any except owner
    }
    if (role === 'admin') {
        return ['viewer', 'editor']; // Admin can assign viewer and editor
    }
    return []; // Editor and viewer cannot assign roles
}

/**
 * Validate that a role string is valid
 * @param {string} role - Role to validate
 * @returns {boolean}
 */
function isValidRole(role) {
    return ROLE_HIERARCHY.includes(role);
}

/**
 * Get human-readable role description
 * @param {string} role - Role name
 * @returns {object} Role info with name and description
 */
function getRoleInfo(role) {
    const roleInfo = {
        owner: {
            name: 'Owner',
            description: 'Full account control including billing and deletion',
            color: '#f59e0b' // Amber
        },
        admin: {
            name: 'Admin',
            description: 'Manage team members, settings, and integrations',
            color: '#8b5cf6' // Purple
        },
        editor: {
            name: 'Editor',
            description: 'Edit renewals, users, and application data',
            color: '#3b82f6' // Blue
        },
        viewer: {
            name: 'Viewer',
            description: 'Read-only access to dashboards and reports',
            color: '#6b7280' // Gray
        }
    };
    
    return roleInfo[role] || roleInfo.viewer;
}

/**
 * Get all available roles
 * @returns {string[]}
 */
function getAllRoles() {
    return [...ROLE_HIERARCHY];
}

/**
 * Check if a member can perform an action on another member
 * @param {object} actor - The member performing the action
 * @param {object} target - The member being acted upon
 * @param {string} action - The action (edit, remove, etc.)
 * @returns {boolean}
 */
function canActOnMember(actor, target, action) {
    // Can't act on yourself for certain actions
    if (actor.id === target.id && ['remove', 'changeRole'].includes(action)) {
        return false;
    }
    
    // Owner is protected
    if (target.role === 'owner' && actor.role !== 'owner') {
        return false;
    }
    
    // Must have permission
    const permissionMap = {
        view: 'members.view',
        edit: 'members.edit',
        remove: 'members.remove',
        changeRole: 'members.edit'
    };
    
    const permission = permissionMap[action];
    if (!permission) return false;
    
    return hasPermission(actor.role, permission);
}

module.exports = {
    ROLE_HIERARCHY,
    ROLE_PERMISSIONS,
    getPermissionsForRole,
    hasPermission,
    isRoleAtLeast,
    canModifyRole,
    getAssignableRoles,
    isValidRole,
    getRoleInfo,
    getAllRoles,
    canActOnMember
};

