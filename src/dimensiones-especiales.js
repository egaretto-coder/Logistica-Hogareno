let dimEditIdx = -1;

function saveDimensiones() {
  try {
    localStorage.setItem('liq_dimensiones_especiales', JSON.stringify(AppData.dimensionesEspeciales));
  } catch(e) { console.warn('No se pudo guardar dimensiones:', e); }
  dbPush('dimensiones_especiales');
}

function renderDimensionesEspeciales() {
  const search = (document.getElementById('dim-search')?.value || '').toLowerCase();
  const list = AppData.dimensionesEspeciales.filter(d => {
    if (!search) return true;
    return (
      String(d.tracking||'').toLowerCase().includes(search) ||
      String(d.cliente||'').toLowerCase().includes(search) ||
      String(d.zona||'').toLowerCase().includes(search) ||
      String(d.condicion||'').toLowerCase().includes(search)
    );
  });

  const countEl = document.getElementById('dim-count');
  if (countEl) {
    countEl.textContent = list.length + ' de ' + AppData.dimensionesEspeciales.length + ' dimensiones';
  }

  const body = document.getElementById('dim-table-body');
  if (!list.length) {
    body.innerHTML = '<tr><td colspan="7"><div class="empty-state"><div class="empty-icon">📦</div><div class="empty-title">Sin resultados</div><div class="empty-sub">' +
      (AppData.dimensionesEspeciales.length ? 'Ajustá el buscador' : 'Importá un Excel o agregá manualmente') +
      '</div></div></td></tr>';
    return;
  }

  body.innerHTML = list.map((d, idx) => {
    const realIdx = AppData.dimensionesEspeciales.indexOf(d);
    return '<tr>' +
      '<td class="mono">' + (d.fecha || '—') + '</td>' +
      '<td class="mono"><strong>' + (d.tracking || '—') + '</strong></td>' +
      '<td>' + (d.cliente || '—') + '</td>' +
      '<td>' + (d.zona || '—') + '</td>' +
      '<td><span class="tag" style="background:#fef3c7;color:#92400e">📦 ' + (d.condicion || '—') + '</span></td>' +
      '<td class="mono" style="text-align:right"><strong>' + fmtPeso(d.valor || 0) + '</strong></td>' +
      '<td>' +
        '<div style="display:flex;gap:4px">' +
          '<button class="btn btn-sm" onclick="editDimension(' + realIdx + ')">✎</button>' +
          '<button class="btn btn-sm" style="border-color:#fca5a5;color:#b91c1c" onclick="eliminarDimension(' + realIdx + ')">🗑</button>' +
        '</div>' +
      '</td>' +
      '</tr>';
  }).join('');
}

function openAddDimensionModal() {
  dimEditIdx = -1;
  document.getElementById('modal-dim-title').textContent = 'Agregar dimensión especial';
  document.getElementById('md-fecha').value = new Date().toISOString().slice(0, 10);
  document.getElementById('md-tracking').value = '';
  document.getElementById('md-cliente').value = '';
  document.getElementById('md-zona').value = '';
  document.getElementById('md-condicion').value = '';
  document.getElementById('md-valor').value = '';
  document.getElementById('modal-dim-backdrop').style.display = 'flex';
}

function editDimension(idx) {
  const d = AppData.dimensionesEspeciales[idx];
  if (!d) return;
  dimEditIdx = idx;
  document.getElementById('modal-dim-title').textContent = 'Editar dimensión especial';
  // Convertir fecha DD/MM/YYYY -> YYYY-MM-DD para input
  let fechaInput = d.fecha || '';
  if (fechaInput.includes('/')) {
    const [dd, mm, yy] = fechaInput.split('/');
    fechaInput = yy + '-' + String(mm).padStart(2,'0') + '-' + String(dd).padStart(2,'0');
  }
  document.getElementById('md-fecha').value = fechaInput;
  document.getElementById('md-tracking').value = d.tracking || '';
  document.getElementById('md-cliente').value = d.cliente || '';
  document.getElementById('md-zona').value = d.zona || '';
  document.getElementById('md-condicion').value = d.condicion || '';
  document.getElementById('md-valor').value = d.valor || '';
  document.getElementById('modal-dim-backdrop').style.display = 'flex';
}

function closeDimModal(e) {
  if (!e || e.target.id === 'modal-dim-backdrop') {
    document.getElementById('modal-dim-backdrop').style.display = 'none';
  }
}

function guardarDimensionModal() {
  try {
    const fechaRaw = document.getElementById('md-fecha').value;
    const tracking = document.getElementById('md-tracking').value.trim().toUpperCase();
    const cliente = document.getElementById('md-cliente').value.trim();
    const zona = document.getElementById('md-zona').value.trim().toUpperCase();
    const condicion = document.getElementById('md-condicion').value.trim();
    const valor = parseFloat(document.getElementById('md-valor').value);

    if (!tracking) { alert('El tracking es obligatorio.'); return; }
    if (!condicion) { alert('Ingresá la condición especial.'); return; }
    if (isNaN(valor) || valor < 0) { alert('Ingresá un valor válido.'); return; }

    // Convertir YYYY-MM-DD a DD/MM/YYYY para compatibilidad con XLS
    let fecha = fechaRaw;
    if (fechaRaw && fechaRaw.includes('-')) {
      const [y, m, d] = fechaRaw.split('-');
      fecha = d + '/' + m + '/' + y;
    }

    const entry = { fecha, tracking, cliente, zona, condicion, valor };

    if (dimEditIdx >= 0) {
      AppData.dimensionesEspeciales[dimEditIdx] = entry;
    } else {
      // Verificar duplicado por tracking
      const dup = AppData.dimensionesEspeciales.findIndex(x => String(x.tracking).toUpperCase() === tracking);
      if (dup >= 0) {
        if (!confirm('Ya existe una dimensión para el tracking ' + tracking + '. ¿Reemplazarla?')) return;
        AppData.dimensionesEspeciales[dup] = entry;
      } else {
        AppData.dimensionesEspeciales.push(entry);
      }
    }

    saveDimensiones();
    dimEditIdx = -1;
    document.getElementById('modal-dim-backdrop').style.display = 'none';
    renderDimensionesEspeciales();
    showToast('✅ Dimensión especial guardada');
  } catch(err) {
    console.error(err);
    alert('Error al guardar: ' + err.message);
  }
}

function eliminarDimension(idx) {
  const d = AppData.dimensionesEspeciales[idx];
  if (!d) return;
  if (!confirm('Eliminar la dimensión especial del tracking ' + d.tracking + '?')) return;
  AppData.dimensionesEspeciales.splice(idx, 1);
  saveDimensiones();
  renderDimensionesEspeciales();
  showToast('🗑 Dimensión eliminada');
}

function limpiarDimensiones() {
  if (!AppData.dimensionesEspeciales.length) { showToast('No hay dimensiones para limpiar'); return; }
  if (!confirm('¿Eliminar TODAS las dimensiones especiales cargadas? (' + AppData.dimensionesEspeciales.length + ' registros)')) return;
  AppData.dimensionesEspeciales = [];
  saveDimensiones();
  renderDimensionesEspeciales();
  showToast('🗑 Todas las dimensiones eliminadas');
}

function descargarPlantillaDimensiones() {
  const ws = XLSX.utils.aoa_to_sheet([
    ['Fecha', 'Tracking', 'Cliente', 'Zona', 'Valor', 'Condicion'],
    ['15/06/2026', '12345678', 'Mercado Libre', 'LA PLATA', 6500, 'Volumen grande'],
    ['16/06/2026', '87654321', 'Empresa XYZ', 'CABA', 4200, 'Frágil'],
  ]);
  ws['!cols'] = [{wch:12},{wch:15},{wch:20},{wch:20},{wch:10},{wch:22}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Dimensiones');
  XLSX.writeFile(wb, 'Plantilla_Dimensiones_Especiales.xlsx');
  showToast('📥 Plantilla descargada');
}

function importDimensionesEspeciales(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = new Uint8Array(e.target.result);
      const wb = XLSX.read(data, { type: 'array', cellDates: true });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      if (rows.length < 2) { alert('El archivo está vacío.'); return; }

      // Detectar encabezados
      const header = rows[0].map(h => String(h).toLowerCase().trim());
      const idx = {
        fecha:     header.findIndex(h => h.includes('fecha')),
        tracking:  header.findIndex(h => h.includes('tracking') || h.includes('track')),
        cliente:   header.findIndex(h => h.includes('cliente')),
        zona:      header.findIndex(h => h.includes('zona') || h.includes('localidad')),
        valor:     header.findIndex(h => h.includes('valor') || h.includes('precio') || h.includes('monto')),
        condicion: header.findIndex(h => h.includes('condicion') || h.includes('condición') || h.includes('motivo') || h.includes('tipo'))
      };

      if (idx.tracking < 0) { alert('No se encontró la columna "Tracking".'); return; }
      if (idx.valor < 0) { alert('No se encontró la columna "Valor".'); return; }
      if (idx.condicion < 0) { alert('No se encontró la columna "Condicion".'); return; }

      const nuevos = [];
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        const tracking = String(r[idx.tracking] || '').trim().toUpperCase();
        if (!tracking) continue;
        const valorRaw = r[idx.valor];
        const valor = typeof valorRaw === 'number' ? valorRaw : parseFloat(String(valorRaw).replace(/[^0-9.-]/g,''));
        if (isNaN(valor)) continue;

        // Fecha: puede venir como Date (por cellDates) o string
        let fecha = r[idx.fecha];
        if (fecha instanceof Date) {
          const d = String(fecha.getDate()).padStart(2,'0');
          const m = String(fecha.getMonth()+1).padStart(2,'0');
          const y = fecha.getFullYear();
          fecha = d + '/' + m + '/' + y;
        } else {
          fecha = String(fecha || '').trim();
        }

        nuevos.push({
          fecha,
          tracking,
          cliente: String(r[idx.cliente] || '').trim(),
          zona: String(r[idx.zona] || '').trim().toUpperCase(),
          valor,
          condicion: String(r[idx.condicion] || '').trim()
        });
      }

      if (!nuevos.length) { alert('No se pudo importar ninguna dimensión válida.'); return; }

      // Fusionar con las existentes (reemplazar por tracking)
      const mapExist = {};
      AppData.dimensionesEspeciales.forEach((d, i) => {
        mapExist[String(d.tracking).toUpperCase()] = i;
      });
      let agregadas = 0, actualizadas = 0;
      nuevos.forEach(n => {
        const key = String(n.tracking).toUpperCase();
        if (mapExist[key] !== undefined) {
          AppData.dimensionesEspeciales[mapExist[key]] = n;
          actualizadas++;
        } else {
          AppData.dimensionesEspeciales.push(n);
          agregadas++;
        }
      });

      saveDimensiones();
      renderDimensionesEspeciales();
      showToast('✅ Importado: ' + agregadas + ' nuevas · ' + actualizadas + ' actualizadas');

      // Refrescar liquidaciones si están abiertas
      if (typeof renderLiquidaciones === 'function') {
        const page = document.getElementById('page-liquidaciones');
        if (page && page.classList.contains('active')) renderLiquidaciones();
      }
    } catch(err) {
      console.error(err);
      alert('Error al importar: ' + err.message);
    } finally {
      event.target.value = '';
    }
  };
  reader.readAsArrayBuffer(file);
}

// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// ═════════════════ MÓDULO DESCUENTO CONDUCTORES ══════════════════════════
// ═══════════════════════════════════════════════════════════════════════════

