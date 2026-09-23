import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getRedisClientOptions, getRedisSocketOptions, isRedisConfigured } from './redisClient.js';

test('getRedisSocketOptions respects REDIS_SSL', () => {
  const prevHost = process.env.REDIS_HOST;
  const prevSsl = process.env.REDIS_SSL;
  const prevPort = process.env.REDIS_PORT;

  process.env.REDIS_HOST = 'redis.example.com';
  process.env.REDIS_PORT = '6380';
  process.env.REDIS_SSL = 'true';

  const opts = getRedisSocketOptions();
  assert.equal(opts.host, 'redis.example.com');
  assert.equal(opts.port, 6380);
  assert.equal(opts.tls, true);

  process.env.REDIS_HOST = prevHost ?? '';
  process.env.REDIS_SSL = prevSsl ?? 'false';
  process.env.REDIS_PORT = prevPort ?? '6379';
});

test('getRedisClientOptions includes auth when set', () => {
  const prevUser = process.env.REDIS_USERNAME;
  const prevPass = process.env.REDIS_PASSWORD;
  process.env.REDIS_USERNAME = 'user';
  process.env.REDIS_PASSWORD = 'secret';

  const opts = getRedisClientOptions();
  assert.equal(opts.username, 'user');
  assert.equal(opts.password, 'secret');

  if (prevUser === undefined) delete process.env.REDIS_USERNAME;
  else process.env.REDIS_USERNAME = prevUser;
  if (prevPass === undefined) delete process.env.REDIS_PASSWORD;
  else process.env.REDIS_PASSWORD = prevPass;
});

test('isRedisConfigured is false without REDIS_HOST', () => {
  const prev = process.env.REDIS_HOST;
  process.env.REDIS_HOST = '';
  assert.equal(isRedisConfigured(), false);
  process.env.REDIS_HOST = prev ?? '127.0.0.1';
});
