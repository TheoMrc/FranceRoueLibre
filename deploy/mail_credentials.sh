# Run on the VPS by mail_credentials.bat (password on stdin, never on a command line nor in a file in clear):
# checks the login on OVH's SMTP and IMAP servers, then stores the password encrypted with systemd-creds in
# /etc/francerouelibre/mail-password.cred (root only, decrypted by systemd for the assistant service alone) and the
# address in /etc/francerouelibre/mail.env. deploy/vps.sh then hands both to the service.
set -euo pipefail
USER_ADDR=${1:-stonks@francerouelibre.fr}
IFS= read -r PASS
PASS=${PASS%$'\r'}
[ -n "$PASS" ] || { echo "mot de passe vide"; exit 1; }
printf '%s' "$PASS" | python3 -c '
import imaplib, smtplib, ssl, sys
user, pwd = sys.argv[1], sys.stdin.read()
ctx = ssl.create_default_context()
with smtplib.SMTP_SSL("ssl0.ovh.net", 465, context=ctx, timeout=30) as s:
    s.login(user, pwd)
print("SMTP ssl0.ovh.net:465 : connexion OK")
box = imaplib.IMAP4_SSL("imap.mail.ovh.net", 993, ssl_context=ctx, timeout=30)
box.login(user, pwd); box.logout()
print("IMAP imap.mail.ovh.net:993 : connexion OK")
' "$USER_ADDR" || { echo "Connexion refusée : rien n'a été enregistré."; exit 1; }
sudo -n mkdir -p /etc/francerouelibre && sudo -n chmod 700 /etc/francerouelibre
printf '%s' "$PASS" | sudo -n systemd-creds encrypt --name=mail-password - /etc/francerouelibre/mail-password.cred
sudo -n chmod 600 /etc/francerouelibre/mail-password.cred
printf 'MAIL_USER=%s\nMAIL_FROM=%s\n' "$USER_ADDR" "$USER_ADDR" | sudo -n tee /etc/francerouelibre/mail.env > /dev/null
sudo -n chmod 600 /etc/francerouelibre/mail.env
unset PASS
echo "Mot de passe chiffré dans /etc/francerouelibre/mail-password.cred (systemd-creds)."
