# ============================================================================
#  RESPALDO DE LA BASE  ·  Logística Hogareño
#  ----------------------------------------------------------------------------
#  Baja la base ENTERA (estructura + datos) a un archivo comprimido y conserva
#  las últimas N copias.
#
#  POR QUÉ EXISTE, si Supabase ya hace backups diarios:
#    · El plan Pro guarda los últimos 7 días. En esta app los errores tardan
#      MÁS que eso en aparecer — la lista de CERAMITODO x90 se descubrió días
#      después, y la semana sin facturar de GAMING CITY casi un mes. Con 7 días
#      de retención ninguno de los dos se habría podido revertir.
#    · Y si el proyecto se borra, Supabase borra también sus backups. Un
#      respaldo que vive adentro de lo que querés proteger no es un respaldo.
#
#  El archivo queda en TU disco. Si apuntás -Destino a una carpeta de Drive o
#  OneDrive, se sincroniza solo y ahí sí está fuera de Supabase.
#
#  ----------------------------------------------------------------------------
#  PRIMERA VEZ (una sola vez, pide el navegador):
#      npx -y supabase@latest login
#
#  Y NADA MÁS: el proyecto se pasa por --remote=<ref>, que es el -Proyecto de
#  acá abajo. NO hace falta "supabase link": ese se guarda POR CARPETA, así que
#  corrido en otro directorio el respaldo falla con ProjectRefNotLinkedError y
#  no hay forma de saber por qué (pasó, 04/11/2026). Un paso manual que se puede
#  hacer en el lugar equivocado es un paso que va a fallar.
#
#  Si preferís no depender del login interactivo -por ejemplo para la tarea
#  programada- creá un Personal Access Token en Supabase y dejalo en la variable
#  de entorno SUPABASE_ACCESS_TOKEN. El CLI usa cualquiera de las dos.
#
#  USO:
#      .\scripts\respaldo.ps1
#      .\scripts\respaldo.ps1 -Destino "G:\Mi unidad\Respaldos Liquidaciones"
#
#  PROGRAMARLO (todos los lunes a las 8:05; una línea, una vez):
#      schtasks /create /tn "Respaldo Liquidaciones" /sc weekly /d MON /st 08:05 ^
#        /tr "powershell -NoProfile -ExecutionPolicy Bypass -File C:\LogisticaLiquidaciones\scripts\respaldo.ps1"
#
#  NO CONTIENE NINGUNA CREDENCIAL: el token lo guarda el CLI de Supabase en tu
#  perfil de usuario. Por eso este archivo puede vivir en el repo.
# ============================================================================

param(
  [string]$Destino = "$env:USERPROFILE\Respaldos-Liquidaciones",
  [int]$Conservar  = 12,
  [string]$Proyecto = "rsglddbierwejiusrpvd"
)

$ErrorActionPreference = 'Stop'
$sello = Get-Date -Format 'yyyy-MM-dd_HHmm'

function Log($txt) { Write-Host ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $txt) }

if (-not (Test-Path $Destino)) { New-Item -ItemType Directory -Path $Destino -Force | Out-Null }
$trabajo = Join-Path $Destino "_tmp_$sello"
New-Item -ItemType Directory -Path $trabajo -Force | Out-Null

try {
  # La ESTRUCTURA y los DATOS van en dos archivos: para restaurar se crea
  # primero el esquema y después se cargan las filas. Un dump único también
  # sirve, pero separados se puede rearmar la estructura sin traer 100 MB.
  # El CLI escribe avisos por stderr (deprecaciones, progreso). Con
  # ErrorActionPreference='Stop', PowerShell convierte CUALQUIER línea de stderr
  # de un .exe en un error terminante — así que un simple "deprecated" abortaba
  # un respaldo que estaba saliendo bien. Lo que vale es el CÓDIGO DE SALIDA.
  $ErrorActionPreference = 'Continue'

  Log "Bajando la estructura…"
  npx -y supabase@latest db dump --remote=$Proyecto -f (Join-Path $trabajo 'esquema.sql')
  if ($LASTEXITCODE -ne 0) { $ErrorActionPreference='Stop'; throw "El dump de la estructura falló (exit $LASTEXITCODE)" }

  Log "Bajando los datos… (es lo que tarda)"
  npx -y supabase@latest db dump --remote=$Proyecto --data-only -f (Join-Path $trabajo 'datos.sql')
  if ($LASTEXITCODE -ne 0) { $ErrorActionPreference='Stop'; throw "El dump de los datos falló (exit $LASTEXITCODE)" }

  $ErrorActionPreference = 'Stop'

  # UN RESPALDO QUE NO SE PUEDE VERIFICAR NO ES UN RESPALDO: si el dump sale
  # vacío o cortado, hay que enterarse ACÁ y no el día que haga falta usarlo.
  $fEsq = Get-Item (Join-Path $trabajo 'esquema.sql')
  $fDat = Get-Item (Join-Path $trabajo 'datos.sql')
  if ($fEsq.Length -lt 10KB) { throw "La estructura salió sospechosamente chica ($([math]::Round($fEsq.Length/1KB)) KB)" }
  if ($fDat.Length -lt 1MB)  { throw "Los datos salieron sospechosamente chicos ($([math]::Round($fDat.Length/1MB,1)) MB)" }

  # Un marcador con lo que se puede chequear a ojo al restaurar.
  @(
    "Respaldo de Logística Hogareño",
    "Proyecto : $Proyecto",
    "Fecha    : $(Get-Date -Format 'dd/MM/yyyy HH:mm')",
    "Estructura: $([math]::Round($fEsq.Length/1KB)) KB",
    "Datos     : $([math]::Round($fDat.Length/1MB,1)) MB",
    "",
    "Para restaurar en un proyecto NUEVO y vacío:",
    "  psql <URL-del-proyecto-nuevo> -f esquema.sql",
    "  psql <URL-del-proyecto-nuevo> -f datos.sql"
  ) | Set-Content -Path (Join-Path $trabajo 'LEEME.txt') -Encoding utf8

  $zip = Join-Path $Destino "respaldo_$sello.zip"
  Log "Comprimiendo…"
  Compress-Archive -Path (Join-Path $trabajo '*') -DestinationPath $zip -Force
  Remove-Item $trabajo -Recurse -Force

  $mb = [math]::Round((Get-Item $zip).Length / 1MB, 1)
  Log "LISTO: $zip  ($mb MB)"

  # Rotación: se conservan las últimas N. Sin esto el disco se llena solo y el
  # respaldo termina fallando justo por existir.
  $viejos = Get-ChildItem $Destino -Filter 'respaldo_*.zip' |
            Sort-Object LastWriteTime -Descending | Select-Object -Skip $Conservar
  foreach ($v in $viejos) { Log "Borrando copia vieja: $($v.Name)"; Remove-Item $v.FullName -Force }

  Log ("Copias guardadas: {0}" -f (Get-ChildItem $Destino -Filter 'respaldo_*.zip').Count)
}
catch {
  # Un respaldo que falla en silencio es peor que no tenerlo: deja creyendo que
  # hay una copia. Por eso sale con código != 0 y lo deja anotado.
  Log "FALLÓ: $($_.Exception.Message)"
  if (Test-Path $trabajo) { Remove-Item $trabajo -Recurse -Force }
  $log = Join-Path $Destino 'ERRORES.txt'
  "[$(Get-Date -Format 'dd/MM/yyyy HH:mm')] $($_.Exception.Message)" | Add-Content -Path $log -Encoding utf8
  Write-Host ""
  Write-Host "  El respaldo NO se hizo. Revisá $log" -ForegroundColor Red
  Write-Host "  Si dice AccessTokenRequiredError, el CLI no tiene token. Dos formas:" -ForegroundColor Yellow
  Write-Host "     npx -y supabase@latest login        (abre el navegador)" -ForegroundColor Yellow
  Write-Host "     o bien crear un Personal Access Token en Supabase y exportarlo" -ForegroundColor Yellow
  Write-Host "     como SUPABASE_ACCESS_TOKEN (sirve para la tarea programada)." -ForegroundColor Yellow
  exit 1
}
