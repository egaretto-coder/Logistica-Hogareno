// ===== CONFIG TARIFAS =====
// El tarifario por zona se actualiza (aprox. cada 30 días) descargando una
// plantilla Excel, completando los valores y volviéndola a subir. Ya NO se
// edita a mano desde el panel.

const TARIFAS_CATEGORIAS = ['Muy cerca', 'Cerca', 'Intermedio', 'Lejos', 'Muy Lejos'];
const PLANTILLA_TARIFAS_HEADERS = ['Zona', 'Categoría', 'S/ Colecta', 'C/ Colecta', 'SLA Cumplido'];

function renderTarifas() {
  const cont = document.getElementById('tarifas-rows');
  if (!cont) return;
  const filas = AppData.tarifas.map(t => `
    <div style="display:grid;grid-template-columns:2fr 1fr 110px 110px 110px;gap:0;padding:9px 16px;border-bottom:1px solid var(--border);align-items:center;font-size:13px">
      <span style="font-weight:500">${t.zona}</span>
      <span style="font-size:12px;color:var(--text-secondary)">${t.categoria || '—'}</span>
      <span style="text-align:right">${fmtPeso(t.s_colecta)}</span>
      <span style="text-align:right">${fmtPeso(t.c_colecta)}</span>
      <span style="text-align:right">${fmtPeso(t.sla)}</span>
    </div>`).join('');
  cont.innerHTML = filas ||
    '<div style="padding:28px;text-align:center;color:var(--text-muted)">Sin tarifas cargadas. Descargá la plantilla, completala y subila.</div>';
}

function saveTarifas() {
  localStorage.setItem('liq_tarifas', JSON.stringify(AppData.tarifas));
  dbPush('tarifas');
}

// Descarga una plantilla Excel prellenada con las zonas y valores actuales,
// para que el usuario solo actualice los precios.
function descargarPlantillaTarifas() {
  const zonas = [...AppData.tarifas].sort((a, b) =>
    String(a.zona).localeCompare(String(b.zona)));
  const aoa = [
    ['⚠ NO MODIFIQUES NI REORDENES LOS ENCABEZADOS DE LA FILA 2. Actualizá solo los valores (S/ Colecta, C/ Colecta, SLA) a partir de la fila 3. Podés cambiar la Categoría si corresponde. No borres la columna Zona ni dejes filas vacías entre datos.'],
    PLANTILLA_TARIFAS_HEADERS,
    ...zonas.map(t => [
      t.zona,
      t.categoria || '',
      Number(t.s_colecta) || 0,
      Number(t.c_colecta) || 0,
      Number(t.sla) || 0,
    ]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 26 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 14 }];
  ws['!rows'] = [{ hpx: 42 }];
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 4 } }];
  // Fija la fila de encabezados al desplazarse.
  ws['!sheetPr'] = { pane: { ySplit: 2, topLeftCell: 'A3', activePane: 'bottomLeft', state: 'frozen' } };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Tarifas');
  XLSX.writeFile(wb, 'Plantilla_Tarifas_Zonas.xlsx');
  showToast('📥 Plantilla descargada — actualizá los valores y volvé a subirla');
}

// Interpreta un valor de precio (soporta números o texto con separadores es-AR).
// Devuelve null si la celda está vacía (para no pisar el valor actual).
function parseTarifaMoneda(v) {
  if (v === '' || v === null || v === undefined) return null;
  if (typeof v === 'number') return v;
  let s = String(v).trim().replace(/[^\d.,-]/g, '');
  if (s === '') return null;
  if (s.includes(',')) {
    // Coma decimal (es-AR): los puntos son separadores de miles.
    s = s.replace(/\./g, '').replace(',', '.');
  } else {
    const parts = s.split('.');
    // Sólo puntos y el último grupo tiene 3 dígitos → separador de miles.
    if (parts.length > 1 && parts[parts.length - 1].length === 3) s = parts.join('');
  }
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

// Lee la plantilla completada y actualiza el tarifario (por nombre de zona).
function importTarifas(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const data = new Uint8Array(e.target.result);
      const wb = XLSX.read(data, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      if (rows.length < 2) { alert('El archivo está vacío o no tiene datos suficientes.'); return; }

      // Ubicar la fila de encabezados (la que contiene "Zona").
      let hIdx = -1;
      for (let r = 0; r < Math.min(rows.length, 6); r++) {
        if (rows[r].some(h => String(h).toLowerCase().includes('zona'))) { hIdx = r; break; }
      }
      if (hIdx < 0) {
        alert('No se encontró la fila de encabezados (debe incluir "Zona").\n\nDescargá la plantilla oficial para usar la estructura correcta.');
        return;
      }

      const norm = s => String(s).toLowerCase().replace(/[^a-z]/g, '');
      const header = rows[hIdx].map(norm);
      const col = {
        zona:      header.findIndex(h => h.includes('zona')),
        categoria: header.findIndex(h => h.includes('categor')),
        s:         header.findIndex(h => h.includes('scolecta') || h.includes('sincolecta')),
        c:         header.findIndex(h => h.includes('ccolecta') || h.includes('concolecta')),
        sla:       header.findIndex(h => h.includes('sla')),
      };
      if (col.zona < 0) { alert('No se encontró la columna "Zona" en los encabezados.'); return; }

      const validCat = c => TARIFAS_CATEGORIAS.find(
        x => x.toLowerCase() === String(c).toLowerCase().trim()) || null;

      const mapExist = {};
      AppData.tarifas.forEach((t, i) => { mapExist[String(t.zona).toUpperCase().trim()] = i; });

      let actualizados = 0, agregados = 0;
      for (let i = hIdx + 1; i < rows.length; i++) {
        const r = rows[i];
        const zona = String(r[col.zona] || '').trim().toUpperCase();
        if (!zona) continue;
        const s   = col.s   >= 0 ? parseTarifaMoneda(r[col.s])   : null;
        const c   = col.c   >= 0 ? parseTarifaMoneda(r[col.c])   : null;
        const sla = col.sla >= 0 ? parseTarifaMoneda(r[col.sla]) : null;
        const cat = col.categoria >= 0 ? validCat(r[col.categoria]) : null;

        if (mapExist[zona] !== undefined) {
          const t = AppData.tarifas[mapExist[zona]];
          if (s   != null) t.s_colecta = s;
          if (c   != null) t.c_colecta = c;
          if (sla != null) t.sla = sla;
          if (cat) t.categoria = cat;
          actualizados++;
        } else {
          AppData.tarifas.push({
            zona, categoria: cat || 'Intermedio',
            s_colecta: s || 0, c_colecta: c || 0, sla: sla || 0,
          });
          agregados++;
        }
      }

      if (!actualizados && !agregados) { alert('No se encontraron zonas válidas para importar.'); return; }

      AppData.tarifas.sort((a, b) => String(a.zona).localeCompare(String(b.zona)));
      saveTarifas();
      renderTarifas();
      showToast('✅ Tarifario actualizado: ' + actualizados + ' zonas · ' + agregados + ' nuevas');
    } catch (err) {
      console.error(err);
      alert('Error al importar: ' + err.message);
    } finally {
      event.target.value = '';
    }
  };
  reader.readAsArrayBuffer(file);
}

// ===== CONFIG SUPER SLA =====
