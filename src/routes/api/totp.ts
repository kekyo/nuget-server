// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { User, UserService } from '../../services/userService.ts';
import type { SessionService } from '../../services/sessionService.ts';
import type { TotpService } from '../../services/totpService.ts';

/**
 * Registers browser-only second-factor endpoints.
 * @param fastify Server instance.
 * @param users Account store.
 * @param sessions Authenticated session store.
 * @param totp Second-factor service.
 * @param issueSession Sets a new authenticated session cookie.
 * @param enabled Whether the registry uses UI authentication.
 * @returns Resolves when routes have been registered.
 */
export const registerTotpRoutes = async (
  fastify: FastifyInstance,
  users: UserService,
  sessions: SessionService,
  totp: TotpService,
  issueSession: (
    user: User,
    rememberMe: boolean,
    request: FastifyRequest,
    reply: FastifyReply
  ) => Promise<void>,
  enabled: boolean
): Promise<void> => {
  await fastify.register(async (scope) => {
    scope.addHook('onRequest', async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      if (!enabled) return reply.code(404).send({ code: 'TOTP_UNAVAILABLE' });
      // JSON requests plus an explicit header prevent cross-site form submissions.
      if (
        request.headers.origin &&
        request.headers['x-requested-with'] !== 'XMLHttpRequest'
      ) {
        return reply.code(403).send({ code: 'TOTP_FORBIDDEN' });
      }
    });
    scope.setErrorHandler((error, _request, reply) => {
      const failure = error as { code?: string; statusCode?: number };
      const status = failure.statusCode ?? 500;
      if (status === 429) reply.header('Retry-After', '600');
      return reply.code(status).send({
        success: false,
        code: status < 500 ? failure.code : 'TOTP_STORAGE_ERROR',
      });
    });
    scope.post<{ Body: { code: string; recovery?: boolean } }>(
      '/api/auth/login/totp',
      {
        schema: {
          body: {
            type: 'object',
            required: ['code'],
            additionalProperties: false,
            properties: {
              code: { type: 'string', minLength: 1, maxLength: 100 },
              recovery: { type: 'boolean' },
            },
          },
        },
      },
      async (request, reply) => {
        const result = await totp.verifyLogin(
          request.cookies.totpChallenge ?? '',
          request.body.code,
          request.ip,
          request.body.recovery === true
        );
        reply.clearCookie('totpChallenge', { path: '/' });
        await issueSession(result.user, result.rememberMe, request, reply);
        return {
          success: true,
          user: { username: result.user.username, role: result.user.role },
        };
      }
    );
    scope.post<{
      Body: {
        action: string;
        password?: string;
        code?: string;
        recovery?: boolean;
      };
    }>(
      '/api/ui/totp',
      {
        schema: {
          body: {
            type: 'object',
            required: ['action'],
            additionalProperties: false,
            properties: {
              action: {
                type: 'string',
                enum: [
                  'status',
                  'setup',
                  'confirm',
                  'cancel',
                  'disable',
                  'recovery',
                ],
              },
              password: { type: 'string', maxLength: 1024 },
              code: { type: 'string', maxLength: 100 },
              recovery: { type: 'boolean' },
            },
          },
        },
      },
      async (request, reply) => {
        const sessionToken = request.cookies.sessionToken ?? '';
        const session = await sessions.validateSession(sessionToken);
        if (!session) return reply.code(401).send({ code: 'SESSION_REQUIRED' });
        const user = await users.getUser(session.username);
        if (
          !user ||
          user.id !== session.userId ||
          (user.authVersion ?? 0) !== session.authVersion
        )
          return reply.code(401).send({ code: 'SESSION_REQUIRED' });
        switch (request.body.action) {
          case 'status':
            return {
              enabled: !!user.totp,
              recoveryCodesRemaining: user.totp?.recoveryCodeHashes.length ?? 0,
            };
          case 'setup':
            return await totp.setup(
              user,
              sessionToken,
              request.body.password ?? '',
              request.ip,
              request.body.code ?? '',
              request.body.recovery === true
            );
          case 'confirm': {
            const result = await totp.confirm(
              sessionToken,
              request.body.code ?? '',
              request.ip
            );
            await sessions.deleteAllUserSessions(user.id);
            await issueSession(result.user, false, request, reply);
            return { success: true, recoveryCodes: result.recoveryCodes };
          }
          case 'cancel':
            totp.cancel(sessionToken, '');
            return { success: true };
          case 'disable':
          case 'recovery': {
            const result = await totp.manage(
              user,
              request.body.password ?? '',
              request.body.code ?? '',
              request.body.recovery === true,
              request.body.action,
              request.ip
            );
            await sessions.deleteAllUserSessions(user.id);
            await issueSession(result.user, false, request, reply);
            return { success: true, recoveryCodes: result.recoveryCodes };
          }
          default:
            return reply.code(400).send({ code: 'TOTP_INVALID' });
        }
      }
    );
  });
};
