const { z } = require('zod');

const loginSchema = z.object({
  email: z.preprocess(
    (value) => (typeof value === 'string' ? value.trim() : ''),
    z.string().min(1, 'Email and password are required').email('Enter a valid email address')
  ),
  password: z.preprocess(
    (value) => (typeof value === 'string' ? value : ''),
    z.string().min(1, 'Email and password are required')
  ),
});

module.exports = { loginSchema };
