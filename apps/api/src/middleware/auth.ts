import { Request, Response, NextFunction } from 'express';
import { safeLog } from '@scaffold/shared';

/**
 * User information passed by oauth2_proxy
 */
export interface AuthUser {
  email: string;
  user?: string;
  accessToken?: string;
}

/**
 * Extended request with user information
 */
export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

/**
 * Check if authentication is enabled via environment
 */
export function isAuthEnabled(): boolean {
  return process.env['AUTH_ENABLED'] === 'true';
}

/**
 * Middleware to extract user info from oauth2_proxy headers
 *
 * oauth2_proxy passes these headers when user is authenticated:
 * - X-Forwarded-User: username
 * - X-Forwarded-Email: user email
 * - X-Forwarded-Access-Token: OAuth access token (if PASS_ACCESS_TOKEN=true)
 */
export function authMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  // If auth is not enabled, skip authentication
  if (!isAuthEnabled()) {
    return next();
  }

  const email = req.headers['x-forwarded-email'] as string | undefined;
  const user = req.headers['x-forwarded-user'] as string | undefined;
  const accessToken = req.headers['x-forwarded-access-token'] as string | undefined;

  // If no email header, user is not authenticated
  if (!email) {
    safeLog('warn', 'auth_missing', {
      path: req.path,
    });
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required. Please sign in.',
    });
    return;
  }

  // Attach user info to request
  req.user = {
    email,
    user,
    accessToken,
  };

  safeLog('info', 'auth_success', {
    userEmail: email.split('@')[0] + '@...', // Log partial email for privacy
  });

  next();
}

/**
 * Middleware to require authentication on specific routes
 * Use this for routes that must have a logged-in user
 */
export function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  if (!req.user) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'This endpoint requires authentication.',
    });
    return;
  }
  next();
}
