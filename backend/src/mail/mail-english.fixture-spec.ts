/**
 * The HTML English mail had before the catalogue, written out by hand from the
 * old templates for the inputs in mail-english.spec.ts.
 */

export const ACTIVATION_CODE_HTML = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Verify Your Email</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #333;">Verify Your Email Address</h2>
            <p>Hi,</p>
            <p>Thank you for registering! Please use the following 6-digit verification code to complete your registration:</p>
            <div style="background-color: #f5f5f5; padding: 20px; text-align: center; border-radius: 5px; margin: 20px 0;">
              <span style="font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #007bff;">123456</span>
            </div>
            <p>This code will expire in 10 minutes.</p>
            <p>If you didn't request this code, you can safely ignore this email.</p>
            <p>Best regards,<br>The Team</p>
          </div>
        </body>
      </html>
    `;

export const EMAIL_CHANGE_CODE_HTML = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Confirm Your New Email</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #333;">Confirm Your New Email Address</h2>
            <p>Hi,</p>
            <p>An administrator changed the email address on your account. Open the confirmation page and enter this code to finish the change:</p>
            <div style="background-color: #f5f5f5; padding: 20px; text-align: center; border-radius: 5px; margin: 20px 0;">
              <span style="font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #007bff;">123456</span>
            </div>
            <div style="margin: 20px 0;">
              <a href="http://localhost:3000/auth/confirm-email-change" style="background-color: #007bff; color: #ffffff; padding: 12px 20px; border-radius: 5px; text-decoration: none; display: inline-block;">Confirm the new address</a>
            </div>
            <p>If the button does not work, paste this address into your browser:</p>
            <p style="word-break: break-all; color: #555;">http://localhost:3000/auth/confirm-email-change</p>
            <p>This code will expire in 10 minutes.</p>
            <p>If you didn't expect this change, contact your administrator.</p>
            <p>Best regards,<br>The Team</p>
          </div>
        </body>
      </html>
    `;

export const EMAIL_CHANGE_NOTICE_HTML =
  '<!DOCTYPE html><html><body><p>Hi,</p><p>An administrator requested to change the email address on your account. Your existing address remains active until the new address is confirmed. If you did not expect this request, contact your administrator.</p><p>Best regards,<br>The Team</p></body></html>';

/** For the name `O'Brien <x>`. */
export const PASSWORD_RESET_CODE_HTML = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Reset Your Password</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #333;">Reset Your Password</h2>
            <p>Hi O&#39;Brien &lt;x&gt;,</p>
            <p>You requested to reset your password. Please use the following 6-digit code to reset your password:</p>
            <div style="background-color: #f5f5f5; padding: 20px; text-align: center; border-radius: 5px; margin: 20px 0;">
              <span style="font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #dc3545;">123456</span>
            </div>
            <p>This code will expire in 10 minutes.</p>
            <p>If you didn't request this code, you can safely ignore this email. Your password will remain unchanged.</p>
            <p>Best regards,<br>The Team</p>
          </div>
        </body>
      </html>
    `;

/** For the link `http://localhost:3000/auth/magic-link/verify?token=abc123&next=1`, 15 minutes. */
export const MAGIC_LINK_HTML = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Your Sign-In Link</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #333;">Your Sign-In Link</h2>
            <p>Use this link to sign in. It works once.</p>
            <div style="margin: 20px 0;">
              <a href="http://localhost:3000/auth/magic-link/verify?token=abc123&amp;next=1" style="background-color: #007bff; color: #ffffff; padding: 12px 20px; border-radius: 5px; text-decoration: none; display: inline-block;">Sign in</a>
            </div>
            <p>If the button does not work, paste this address into your browser:</p>
            <p style="word-break: break-all; color: #555;">http://localhost:3000/auth/magic-link/verify?token=abc123&amp;next=1</p>
            <p>The link expires in 15 minutes.</p>
            <p>If you did not request this, ignore this email.</p>
            <p>Best regards,<br>The Team</p>
          </div>
        </body>
      </html>
    `;
