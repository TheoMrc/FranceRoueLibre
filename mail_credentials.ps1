# Asks the password of the site's mailbox (Zimbra OVH) and stores it encrypted on biodevs-vps (systemd-creds), then
# redeploys so that the AI assistant can send the requests and read the replies. Launched by mail_credentials.bat.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Write-Host "Boîte mail du site pour les demandes aux administrations (Zimbra OVH)`n"
$user = Read-Host 'Adresse (Entrée = stonks@francerouelibre.fr)'
if (-not $user) { $user = 'stonks@francerouelibre.fr' }
if ($user -notmatch '^[\w.+-]+@[\w-]+(\.[\w-]+)+$') { throw "Adresse invalide : $user" }
$secure = Read-Host 'Mot de passe' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  Write-Host "`n=== Vérification et enregistrement chiffré sur biodevs-vps"
  $plain | ssh -o BatchMode=yes biodevs-vps "bash /var/www/francerouelibre/deploy/mail_credentials.sh $user"
  if ($LASTEXITCODE -ne 0) { throw 'Échec : identifiants non enregistrés.' }
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr); $plain = $null
}
Write-Host "`n=== Redéploiement (le service reçoit le mot de passe déchiffré par systemd)"
Get-Content -Raw deploy\vps.sh | ssh -o BatchMode=yes biodevs-vps "bash -s"
if ($LASTEXITCODE -ne 0) { throw 'Le redéploiement a échoué.' }
Write-Host "`n=== Test d'envoi et de lecture depuis le service"
ssh -o BatchMode=yes biodevs-vps "frl-demandes test"
