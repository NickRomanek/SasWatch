// Authentication Utilities
// Password hashing, session management, and authentication middleware
// Supports both legacy Account login and new AccountMember RBAC system

const bcrypt = require('bcrypt');
const { randomUUID } = require('crypto');
const prisma = require('./prisma');
const permissions = require('./permissions');

const SALT_ROUNDS = 10;

// ============================================
// Password Management
// ============================================

async function hashPassword(password) {
    return await bcrypt.hash(password, SALT_ROUNDS);
}

async function comparePassword(password, hash) {
    return await bcrypt.compare(password, hash);
}

// ============================================
// AccountMember Operations (RBAC)
// ============================================

/**
 * Create a new account member (team member)
 * @param {string} accountId - The account to add member to
 * @param {object} data - Member data { email, name, password, role }
 * @param {string} invitedById - ID of member who invited them (optional)
 */
async function createMember(accountId, data, invitedById = null) {
    const { generateSecureToken } = require('./security');
    
    // Check if email already exists (globally unique)
    const existing = await prisma.accountMember.findUnique({
        where: { email: data.email }
    });
    
    if (existing) {
        throw new Error('A member with this email already exists');
    }
    
    // Verify account exists
    const account = await prisma.account.findUnique({ where: { id: accountId } });
    if (!account) {
        throw new Error('Account not found');
    }
    
    // Validate role
    if (data.role && !permissions.isValidRole(data.role)) {
        throw new Error('Invalid role');
    }
    
    const hashedPassword = data.password ? await hashPassword(data.password) : null;
    const verificationToken = generateSecureToken();
    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    
    const member = await prisma.accountMember.create({
        data: {
            accountId,
            email: data.email.toLowerCase().trim(),
            password: hashedPassword,
            name: data.name,
            role: data.role || 'viewer',
            isActive: !!hashedPassword, // Active if password set, otherwise pending invitation
            emailVerified: false,
            emailVerificationToken: verificationToken,
            emailVerificationExpires: verificationExpires,
            mfaEnabled: true,
            invitedBy: invitedById,
            invitationToken: hashedPassword ? null : generateSecureToken(), // Only for invites
            invitationExpires: hashedPassword ? null : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
        }
    });
    
    return member;
}

/**
 * Authenticate a member by email and password
 */
async function authenticateMember(email, password) {
    try {
        const member = await prisma.accountMember.findUnique({
            where: { email: email.toLowerCase().trim() },
            include: { account: true }
        });
        
        if (!member) {
            return null;
        }
        
        if (!member.isActive) {
            throw new Error('Member account is not active');
        }
        
        if (!member.account.isActive) {
            throw new Error('Organization account is not active');
        }
        
        const isValid = await comparePassword(password, member.password);
        
        if (!isValid) {
            return null;
        }
        
        // Update last login
        await prisma.accountMember.update({
            where: { id: member.id },
            data: { lastLoginAt: new Date() }
        });
        
        // Return member without password
        const { password: _, ...memberWithoutPassword } = member;
        return memberWithoutPassword;
    } catch (error) {
        // If account_members table doesn't exist, return null (fall back to legacy auth)
        if (error.code === 'P2022' && error.meta?.table === 'public.account_members') {
            return null;
        }
        throw error;
    }
}

/**
 * Get member by ID with account info
 */
async function getMemberById(memberId) {
    const member = await prisma.accountMember.findUnique({
        where: { id: memberId },
        include: { account: true }
    });
    
    if (!member) {
        return null;
    }
    
    const { password: _, ...memberWithoutPassword } = member;
    return memberWithoutPassword;
}

/**
 * Get member by email
 */
async function getMemberByEmail(email) {
    const member = await prisma.accountMember.findUnique({
        where: { email: email.toLowerCase().trim() },
        include: { account: true }
    });
    
    if (!member) {
        return null;
    }
    
    const { password: _, ...memberWithoutPassword } = member;
    return memberWithoutPassword;
}

/**
 * Get all members of an account
 */
async function getAccountMembers(accountId) {
    const members = await prisma.accountMember.findMany({
        where: { accountId },
        select: {
            id: true,
            email: true,
            name: true,
            role: true,
            isActive: true,
            emailVerified: true,
            mfaEnabled: true,
            lastLoginAt: true,
            createdAt: true,
            invitedBy: true
        },
        orderBy: [
            { role: 'asc' }, // Owners first
            { createdAt: 'asc' }
        ]
    });
    
    return members;
}

/**
 * Update member role
 */
async function updateMemberRole(memberId, newRole, actorMember) {
    if (!permissions.isValidRole(newRole)) {
        throw new Error('Invalid role');
    }
    
    const targetMember = await prisma.accountMember.findUnique({
        where: { id: memberId }
    });
    
    if (!targetMember) {
        throw new Error('Member not found');
    }
    
    // Check if actor can modify this member
    if (!permissions.canModifyRole(actorMember.role, targetMember.role)) {
        throw new Error('You do not have permission to modify this member');
    }
    
    // Check if actor can assign this role
    const assignableRoles = permissions.getAssignableRoles(actorMember.role);
    if (!assignableRoles.includes(newRole) && newRole !== targetMember.role) {
        throw new Error('You cannot assign this role');
    }
    
    // Can't demote yourself
    if (memberId === actorMember.id && permissions.ROLE_HIERARCHY.indexOf(newRole) < permissions.ROLE_HIERARCHY.indexOf(actorMember.role)) {
        throw new Error('You cannot demote yourself');
    }
    
    return await prisma.accountMember.update({
        where: { id: memberId },
        data: { role: newRole }
    });
}

/**
 * Remove member from account
 */
async function removeMember(memberId, actorMember) {
    const targetMember = await prisma.accountMember.findUnique({
        where: { id: memberId }
    });
    
    if (!targetMember) {
        throw new Error('Member not found');
    }
    
    // Can't remove yourself
    if (memberId === actorMember.id) {
        throw new Error('You cannot remove yourself');
    }
    
    // Can't remove owner
    if (targetMember.role === 'owner') {
        throw new Error('Cannot remove the account owner');
    }
    
    // Check permissions
    if (!permissions.canActOnMember(actorMember, targetMember, 'remove')) {
        throw new Error('You do not have permission to remove this member');
    }
    
    await prisma.accountMember.delete({
        where: { id: memberId }
    });
    
    return true;
}

/**
 * Accept invitation and set password
 */
async function acceptInvitation(token, name, password) {
    const member = await prisma.accountMember.findUnique({
        where: { invitationToken: token }
    });
    
    if (!member) {
        return { success: false, message: 'Invalid or expired invitation link' };
    }
    
    if (member.invitationExpires && new Date() > member.invitationExpires) {
        return { success: false, message: 'Invitation has expired. Please request a new invitation.' };
    }
    
    const hashedPassword = await hashPassword(password);
    
    await prisma.accountMember.update({
        where: { id: member.id },
        data: {
            name: name || member.name,
            password: hashedPassword,
            isActive: true,
            emailVerified: true, // Accepting invite proves email ownership
            invitationToken: null,
            invitationExpires: null
        }
    });
    
    return { success: true, memberId: member.id };
}

/**
 * Request password reset for member
 */
async function requestMemberPasswordReset(email) {
    const { generateSecureToken } = require('./security');
    
    const member = await prisma.accountMember.findUnique({
        where: { email: email.toLowerCase().trim() }
    });
    
    // Don't reveal if member exists
    if (!member) {
        console.log('Password reset requested for non-existent member email:', email);
        return { success: true };
    }
    
    const resetToken = generateSecureToken();
    const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    
    await prisma.accountMember.update({
        where: { id: member.id },
        data: {
            passwordResetToken: resetToken,
            passwordResetExpires: resetExpires
        }
    });
    
    return {
        success: true,
        memberId: member.id,
        email: member.email,
        memberName: member.name,
        token: resetToken
    };
}

/**
 * Reset member password
 */
async function resetMemberPassword(token, newPassword) {
    if (!token) {
        return { success: false, message: 'Reset token is required' };
    }
    
    const member = await prisma.accountMember.findUnique({
        where: { passwordResetToken: token }
    });
    
    if (!member) {
        return { success: false, message: 'Invalid or expired reset link' };
    }
    
    if (member.passwordResetExpires && new Date() > member.passwordResetExpires) {
        return { success: false, message: 'Reset link has expired. Please request a new one.' };
    }
    
    const hashedPassword = await hashPassword(newPassword);
    
    await prisma.accountMember.update({
        where: { id: member.id },
        data: {
            password: hashedPassword,
            passwordResetToken: null,
            passwordResetExpires: null,
            emailVerified: true // Auto-verify
        }
    });
    
    return { success: true, memberId: member.id, email: member.email };
}

// ============================================
// Legacy Account Operations (Backward Compatibility)
// ============================================

async function createAccount(name, email, password) {
    const hashedPassword = await hashPassword(password);
    const { generateSecureToken } = require('./security');
    
    // Check if email already exists
    const existing = await prisma.account.findUnique({
        where: { email }
    });
    
    if (existing) {
        throw new Error('Account with this email already exists');
    }
    
    // Check if first account (make it platform admin)
    const accountCount = await prisma.account.count();
    const isFirstAccount = accountCount === 0;
    
    // Check if this email matches PLATFORM_ADMIN_EMAIL env var
    const platformAdminEmail = (process.env.PLATFORM_ADMIN_EMAIL || '').toLowerCase().trim();
    const isPlatformAdmin = isFirstAccount || (platformAdminEmail && email.toLowerCase().trim() === platformAdminEmail);
    
    // Generate email verification token
    const verificationToken = generateSecureToken();
    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    
    // Create account with auto-generated API key
    const account = await prisma.account.create({
        data: {
            name,
            email: email.toLowerCase().trim(),
            password: hashedPassword, // Keep for backward compatibility
            subscriptionTier: 'free',
            isActive: true,
            isSuperAdmin: isPlatformAdmin, // Legacy field
            platformAdmin: isPlatformAdmin, // New field
            emailVerified: false,
            emailVerificationToken: verificationToken,
            emailVerificationExpires: verificationExpires,
            mfaEnabled: true
        }
    });
    
    // Also create an AccountMember as owner
    await prisma.accountMember.create({
        data: {
            accountId: account.id,
            email: email.toLowerCase().trim(),
            password: hashedPassword,
            name: name,
            role: 'owner',
            isActive: true,
            emailVerified: false,
            emailVerificationToken: verificationToken,
            emailVerificationExpires: verificationExpires,
            mfaEnabled: true
        }
    });
    
    if (isPlatformAdmin) {
        console.log(`[Auth] Account ${email} created as platform admin (${isFirstAccount ? 'first account' : 'env match'})`);
    }
    
    return account;
}

/**
 * Authenticate - tries AccountMember first, falls back to legacy Account
 */
async function authenticateAccount(email, password) {
    // First try AccountMember (new system)
    try {
        const member = await authenticateMember(email, password);
        if (member) {
            // Return in account-compatible format for backward compatibility
            return {
                ...member.account,
                memberId: member.id,
                memberRole: member.role,
                memberName: member.name,
                mfaEnabled: member.mfaEnabled,
                emailVerified: member.emailVerified
            };
        }
    } catch (error) {
        // If member-specific error, throw it
        if (error.message.includes('not active')) {
            throw error;
        }
        // Otherwise fall through to legacy auth
    }
    
    // Fall back to legacy Account authentication
    try {
        const account = await prisma.account.findUnique({
            where: { email: email.toLowerCase().trim() }
        });
        
        if (!account) {
            return null;
        }
        
        if (!account.isActive) {
            throw new Error('Account is not active');
        }
        
        if (!account.password) {
            return null; // No legacy password set
        }
        
        const isValid = await comparePassword(password, account.password);
        
        if (!isValid) {
            return null;
        }
        
        // Update last login (try without platformAdmin if column doesn't exist)
        try {
            await prisma.account.update({
                where: { id: account.id },
                data: { lastLoginAt: new Date() }
            });
        } catch (updateError) {
            // If platformAdmin column missing, use raw SQL
            if (updateError.code === 'P2022') {
                await prisma.$executeRaw`
                    UPDATE accounts SET "lastLoginAt" = NOW() WHERE id = ${account.id}
                `;
            } else {
                throw updateError;
            }
        }
        
        // Return account without password (legacy format)
        const { password: _, ...accountWithoutPassword } = account;
        if (accountWithoutPassword.platformAdmin === undefined) {
            accountWithoutPassword.platformAdmin = false;
        }
        return accountWithoutPassword;
    } catch (error) {
        // If platformAdmin column doesn't exist, use raw SQL query
        if (error.code === 'P2022' && error.meta?.column === 'accounts.platformAdmin') {
            const accounts = await prisma.$queryRaw`
                SELECT id, name, email, password, "apiKey", "isActive", "isSuperAdmin", 
                       "subscriptionTier", "createdAt", "updatedAt", "lastLoginAt",
                       "emailVerified", "mfaEnabled"
                FROM accounts WHERE email = ${email.toLowerCase().trim()}
            `;
            if (!accounts || accounts.length === 0) {
                return null;
            }
            const account = accounts[0];
            if (!account.isActive) {
                throw new Error('Account is not active');
            }
            if (!account.password) {
                return null;
            }
            const isValid = await comparePassword(password, account.password);
            if (!isValid) {
                return null;
            }
            await prisma.$executeRaw`
                UPDATE accounts SET "lastLoginAt" = NOW() WHERE id = ${account.id}
            `;
            return { ...account, platformAdmin: false, password: undefined };
        }
        throw error;
    }
}

async function getAccountById(accountId) {
    try {
        const account = await prisma.account.findUnique({
            where: { id: accountId }
        });
        
        if (!account) {
            return null;
        }
        
        // Return without password, ensure platformAdmin has a default if missing
        const { password: _, ...accountWithoutPassword } = account;
        if (accountWithoutPassword.platformAdmin === undefined) {
            accountWithoutPassword.platformAdmin = false;
        }
        return accountWithoutPassword;
    } catch (error) {
        // If platformAdmin column doesn't exist, query without it
        if (error.code === 'P2022' && error.meta?.column === 'accounts.platformAdmin') {
            const account = await prisma.$queryRaw`
                SELECT id, name, email, "apiKey", "isActive", "isSuperAdmin", 
                       "subscriptionTier", "createdAt", "updatedAt", "lastLoginAt",
                       "entraLastSyncAt", "entraTenantId", "entraConnectedAt",
                       "entraSignInCursor", "entraSignInLastSyncAt", "hiddenLicenses",
                       "licenseCosts", "emailVerified", "emailVerificationToken",
                       "emailVerificationExpires", "passwordResetToken", "passwordResetExpires",
                       "mfaEnabled", "mfaSecret", "mfaBackupCodes", "mfaMethod"
                FROM accounts WHERE id = ${accountId}
            `;
            if (account && account.length > 0) {
                return { ...account[0], platformAdmin: false }; // Default to false
            }
            return null;
        }
        throw error;
    }
}

async function getAccountByApiKey(apiKey) {
    try {
        const account = await prisma.account.findUnique({
            where: { apiKey }
        });
        
        if (!account || !account.isActive) {
            return null;
        }
        
        const { password: _, ...accountWithoutPassword } = account;
        if (accountWithoutPassword.platformAdmin === undefined) {
            accountWithoutPassword.platformAdmin = false;
        }
        return accountWithoutPassword;
    } catch (error) {
        // If platformAdmin column doesn't exist, query without it
        if (error.code === 'P2022' && error.meta?.column === 'accounts.platformAdmin') {
            const account = await prisma.$queryRaw`
                SELECT id, name, email, "apiKey", "isActive", "isSuperAdmin", 
                       "subscriptionTier", "createdAt", "updatedAt", "lastLoginAt",
                       "entraLastSyncAt", "entraTenantId", "entraConnectedAt",
                       "entraSignInCursor", "entraSignInLastSyncAt", "hiddenLicenses",
                       "licenseCosts", "emailVerified", "emailVerificationToken",
                       "emailVerificationExpires", "passwordResetToken", "passwordResetExpires",
                       "mfaEnabled", "mfaSecret", "mfaBackupCodes", "mfaMethod"
                FROM accounts WHERE "apiKey" = ${apiKey}
            `;
            if (account && account.length > 0 && account[0].isActive) {
                return { ...account[0], platformAdmin: false }; // Default to false
            }
            return null;
        }
        throw error;
    }
}

async function regenerateApiKey(accountId) {
    if (!accountId) {
        throw new Error('Missing account ID for API key regeneration');
    }

    const account = await prisma.account.update({
        where: { id: accountId },
        data: { apiKey: randomUUID() },
        select: { apiKey: true }
    });

    return account.apiKey;
}

// ============================================
// Email Verification (Legacy - Account)
// ============================================

async function verifyEmail(token) {
    if (!token) {
        return { success: false, message: 'Verification token is required' };
    }

    // Try AccountMember first
    const member = await prisma.accountMember.findUnique({
        where: { emailVerificationToken: token }
    });
    
    if (member) {
        if (member.emailVerified) {
            return { success: false, message: 'Email already verified' };
        }
        
        if (member.emailVerificationExpires && new Date() > member.emailVerificationExpires) {
            return { success: false, message: 'Verification link has expired. Please request a new one.' };
        }
        
        await prisma.accountMember.update({
            where: { id: member.id },
            data: {
                emailVerified: true,
                emailVerificationToken: null,
                emailVerificationExpires: null
            }
        });
        
        return { success: true, memberId: member.id, email: member.email };
    }

    // Fall back to Account
    const account = await prisma.account.findUnique({
        where: { emailVerificationToken: token }
    });

    if (!account) {
        return { success: false, message: 'Invalid or expired verification link' };
    }

    if (account.emailVerified) {
        return { success: false, message: 'Email already verified' };
    }

    if (account.emailVerificationExpires && new Date() > account.emailVerificationExpires) {
        return { success: false, message: 'Verification link has expired. Please request a new one.' };
    }

    await prisma.account.update({
        where: { id: account.id },
        data: {
            emailVerified: true,
            emailVerificationToken: null,
            emailVerificationExpires: null
        }
    });

    return {
        success: true,
        accountId: account.id,
        email: account.email
    };
}

async function resendVerificationEmail(email) {
    const { generateSecureToken } = require('./security');
    
    // Try member first
    const member = await prisma.accountMember.findUnique({
        where: { email: email.toLowerCase().trim() }
    });
    
    if (member) {
        if (member.emailVerified) {
            throw new Error('Email is already verified');
        }
        
        const verificationToken = generateSecureToken();
        const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
        
        return await prisma.accountMember.update({
            where: { id: member.id },
            data: {
                emailVerificationToken: verificationToken,
                emailVerificationExpires: verificationExpires
            }
        });
    }

    // Fall back to Account
    const account = await prisma.account.findUnique({
        where: { email: email.toLowerCase().trim() }
    });

    if (!account) {
        throw new Error('No account found with this email address');
    }

    if (account.emailVerified) {
        throw new Error('Email is already verified');
    }

    const verificationToken = generateSecureToken();
    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const updatedAccount = await prisma.account.update({
        where: { id: account.id },
        data: {
            emailVerificationToken: verificationToken,
            emailVerificationExpires: verificationExpires
        }
    });

    return updatedAccount;
}

// ============================================
// Password Reset (Legacy - Account)
// ============================================

async function requestPasswordReset(email) {
    const { generateSecureToken } = require('./security');
    
    // Try member first
    const memberResult = await requestMemberPasswordReset(email);
    if (memberResult.memberId) {
        return {
            success: true,
            accountId: null,
            memberId: memberResult.memberId,
            email: memberResult.email,
            accountName: memberResult.memberName,
            token: memberResult.token
        };
    }

    // Fall back to Account
    const account = await prisma.account.findUnique({
        where: { email: email.toLowerCase().trim() }
    });

    if (!account) {
        console.log('Password reset requested for non-existent email:', email);
        return { success: true };
    }

    const resetToken = generateSecureToken();
    const resetExpires = new Date(Date.now() + 60 * 60 * 1000);

    try {
        await prisma.account.update({
            where: { id: account.id },
            data: {
                passwordResetToken: resetToken,
                passwordResetExpires: resetExpires
            }
        });
        
        console.log('Password reset token generated for account:', account.id);
    } catch (error) {
        console.error('Error updating account with password reset token:', error);
        if (error.message && (error.message.includes('Unknown column') || (error.message.includes('column') && error.message.includes('does not exist')))) {
            throw new Error('Database schema is out of date. Please run: npx prisma migrate dev --name add_password_reset');
        }
        throw error;
    }

    return {
        success: true,
        accountId: account.id,
        email: account.email,
        accountName: account.name,
        token: resetToken
    };
}

async function resetPassword(token, newPassword) {
    if (!token) {
        return { success: false, message: 'Reset token is required' };
    }
    
    // Try member first
    const memberResult = await resetMemberPassword(token, newPassword);
    if (memberResult.memberId) {
        return memberResult;
    }

    // Fall back to Account
    const account = await prisma.account.findUnique({
        where: { passwordResetToken: token }
    });

    if (!account) {
        return { success: false, message: 'Invalid or expired reset link' };
    }

    if (account.passwordResetExpires && new Date() > account.passwordResetExpires) {
        return { success: false, message: 'Reset link has expired. Please request a new one.' };
    }

    const hashedPassword = await hashPassword(newPassword);

    await prisma.account.update({
        where: { id: account.id },
        data: {
            password: hashedPassword,
            passwordResetToken: null,
            passwordResetExpires: null,
            emailVerified: true,
            emailVerificationToken: null,
            emailVerificationExpires: null
        }
    });
    
    // Also update corresponding member if exists
    const member = await prisma.accountMember.findFirst({
        where: { accountId: account.id, email: account.email }
    });
    if (member) {
        await prisma.accountMember.update({
            where: { id: member.id },
            data: {
                password: hashedPassword,
                emailVerified: true
            }
        });
    }
    
    console.log(`[Auth] Password reset successful for ${account.email}, email auto-verified`);

    return {
        success: true,
        accountId: account.id,
        email: account.email
    };
}

// ============================================
// Express Middleware
// ============================================

// Middleware to require authentication (session-based)
function requireAuth(req, res, next) {
    console.log('requireAuth check - session:', req.session ? 'exists' : 'missing');
    console.log('requireAuth check - accountId:', req.session?.accountId);
    
    if (!req.session || !req.session.accountId) {
        console.log('Authentication required - redirecting to login');
        if (req.path.startsWith('/api/')) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        return res.redirect('/login');
    }
    
    console.log('Authentication successful, proceeding');
    next();
}

// Middleware to require API key (for PowerShell scripts)
async function requireApiKey(req, res, next) {
    const apiKey = req.headers['x-api-key'] || req.query.api_key;
    
    if (!apiKey) {
        return res.status(401).json({ 
            error: 'API key required',
            message: 'Please provide API key in X-API-Key header'
        });
    }
    
    const account = await getAccountByApiKey(apiKey);
    
    if (!account) {
        return res.status(401).json({ 
            error: 'Invalid API key',
            message: 'API key is invalid or account is not active'
        });
    }
    
    req.account = account;
    req.accountId = account.id;
    
    next();
}

// Middleware to attach account AND member info to request
async function attachAccount(req, res, next) {
    if (req.session && req.session.accountId) {
        const account = await getAccountById(req.session.accountId);
        if (account) {
            req.account = account;
            req.accountId = account.id;
            res.locals.account = account;
            
            // Also attach member if exists
            if (req.session.memberId) {
                const member = await getMemberById(req.session.memberId);
                if (member) {
                    req.member = member;
                    req.memberRole = member.role;
                    res.locals.member = member;
                    res.locals.currentMember = member;
                }
            }
        }
    }
    next();
}

// Optional auth - doesn't require but attaches if present
function optionalAuth(req, res, next) {
    attachAccount(req, res, next);
}

/**
 * Middleware to require a specific role or higher
 * Usage: requireRole(['admin', 'owner'])
 */
function requireRole(allowedRoles) {
    return async (req, res, next) => {
        try {
            // Must be authenticated first
            if (!req.session || !req.session.accountId) {
                if (req.path.startsWith('/api/')) {
                    return res.status(401).json({ error: 'Authentication required' });
                }
                return res.redirect('/login');
            }
            
            // Get member role from session or fetch
            let role = req.session.memberRole;
            
            if (!role && req.session.memberId) {
                const member = await getMemberById(req.session.memberId);
                if (member) {
                    role = member.role;
                    req.member = member;
                }
            }
            
            // Legacy: if no member, assume owner role for backward compatibility
            if (!role) {
                role = 'owner';
            }
            
            // Check if role is allowed
            if (!allowedRoles.includes(role)) {
                const { auditLog } = require('./security');
                auditLog('ROLE_ACCESS_DENIED', req.session.accountId, {
                    path: req.path,
                    requiredRoles: allowedRoles,
                    actualRole: role
                }, req);
                
                if (req.path.startsWith('/api/')) {
                    return res.status(403).json({ 
                        error: 'Insufficient permissions',
                        required: allowedRoles,
                        current: role
                    });
                }
                return res.status(403).render('error', {
                    title: 'Access Denied',
                    message: 'You do not have permission to access this page',
                    account: req.account
                });
            }
            
            req.memberRole = role;
            next();
        } catch (error) {
            console.error('requireRole error:', error);
            if (req.path.startsWith('/api/')) {
                return res.status(500).json({ error: 'Internal server error' });
            }
            return res.status(500).send('Internal server error');
        }
    };
}

/**
 * Middleware to require a specific permission
 * Usage: requirePermission('members.invite')
 */
function requirePermission(permission) {
    return async (req, res, next) => {
        try {
            if (!req.session || !req.session.accountId) {
                if (req.path.startsWith('/api/')) {
                    return res.status(401).json({ error: 'Authentication required' });
                }
                return res.redirect('/login');
            }
            
            let role = req.session.memberRole || req.memberRole;
            
            if (!role && req.session.memberId) {
                const member = await getMemberById(req.session.memberId);
                if (member) {
                    role = member.role;
                    req.member = member;
                }
            }
            
            // Legacy: assume owner for backward compatibility
            if (!role) {
                role = 'owner';
            }
            
            if (!permissions.hasPermission(role, permission)) {
                const { auditLog } = require('./security');
                auditLog('PERMISSION_DENIED', req.session.accountId, {
                    path: req.path,
                    requiredPermission: permission,
                    role: role
                }, req);
                
                if (req.path.startsWith('/api/')) {
                    return res.status(403).json({ 
                        error: 'Permission denied',
                        required: permission
                    });
                }
                return res.status(403).render('error', {
                    title: 'Access Denied',
                    message: 'You do not have permission to perform this action',
                    account: req.account
                });
            }
            
            req.memberRole = role;
            next();
        } catch (error) {
            console.error('requirePermission error:', error);
            if (req.path.startsWith('/api/')) {
                return res.status(500).json({ error: 'Internal server error' });
            }
            return res.status(500).send('Internal server error');
        }
    };
}

/**
 * Middleware to require platform admin access (simplified from requireSuperAdmin)
 * Checks: account.platformAdmin OR legacy (isSuperAdmin + SUPER_ADMIN_EMAILS)
 */
async function requirePlatformAdmin(req, res, next) {
    try {
        if (!req.session || !req.session.accountId) {
            if (req.path.startsWith('/api/')) {
                return res.status(401).json({ error: 'Authentication required' });
            }
            return res.redirect('/login');
        }
        
        const account = await getAccountById(req.session.accountId);
        if (!account) {
            if (req.path.startsWith('/api/')) {
                return res.status(401).json({ error: 'Account not found' });
            }
            return res.redirect('/login');
        }
        
        // New system: check platformAdmin flag
        let isPlatformAdmin = account.platformAdmin === true;
        
        // Legacy fallback: check env variable + isSuperAdmin
        if (!isPlatformAdmin) {
            const adminEmails = (process.env.SUPER_ADMIN_EMAILS || process.env.PLATFORM_ADMIN_EMAIL || '')
                .split(',')
                .map(e => e.trim().toLowerCase())
                .filter(e => e.length > 0);
            
            const isInAllowlist = adminEmails.length > 0 && 
                adminEmails.includes(account.email.toLowerCase());
            const hasLegacyFlag = account.isSuperAdmin === true;
            
            isPlatformAdmin = isInAllowlist && hasLegacyFlag;
        }
        
        if (!isPlatformAdmin) {
            const { auditLog } = require('./security');
            auditLog('PLATFORM_ADMIN_ACCESS_DENIED', account.id, {
                path: req.path,
                email: account.email
            }, req);
            
            if (req.path.startsWith('/api/')) {
                return res.status(403).json({ error: 'Platform admin access required' });
            }
            return res.status(403).send('Access denied: Platform admin privileges required');
        }
        
        req.account = account;
        req.isPlatformAdmin = true;
        next();
    } catch (error) {
        console.error('requirePlatformAdmin error:', error);
        if (req.path.startsWith('/api/')) {
            return res.status(500).json({ error: 'Internal server error' });
        }
        return res.status(500).send('Internal server error');
    }
}

// Legacy middleware (keep for backward compatibility, delegates to new)
async function requireSuperAdmin(req, res, next) {
    return requirePlatformAdmin(req, res, next);
}

// ============================================
// Utility Functions
// ============================================

function generateRandomPassword(length = 16) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    let password = '';
    for (let i = 0; i < length; i++) {
        password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
}

function sanitizeAccountForClient(account) {
    const { password, ...safe } = account;
    return safe;
}

function sanitizeMemberForClient(member) {
    const { password, mfaSecret, mfaBackupCodes, ...safe } = member;
    return safe;
}

module.exports = {
    // Password
    hashPassword,
    comparePassword,
    
    // Account Member operations (RBAC)
    createMember,
    authenticateMember,
    getMemberById,
    getMemberByEmail,
    getAccountMembers,
    updateMemberRole,
    removeMember,
    acceptInvitation,
    requestMemberPasswordReset,
    resetMemberPassword,
    
    // Legacy Account operations
    createAccount,
    authenticateAccount,
    getAccountById,
    getAccountByApiKey,
    regenerateApiKey,
    
    // Email verification
    verifyEmail,
    resendVerificationEmail,
    
    // Password reset
    requestPasswordReset,
    resetPassword,
    
    // Middleware
    requireAuth,
    requireApiKey,
    attachAccount,
    optionalAuth,
    requireRole,
    requirePermission,
    requirePlatformAdmin,
    requireSuperAdmin, // Legacy alias
    
    // Utilities
    generateRandomPassword,
    sanitizeAccountForClient,
    sanitizeMemberForClient
};
