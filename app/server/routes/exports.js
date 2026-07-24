const express = require('express');
const XLSX = require('xlsx');
const { buildFullDump, writeBackupFile } = require('../backup');

const router = express.Router();

router.get('/json', (req, res) => {
  const dump = buildFullDump();
  const stamp = dump.exported_at.replace(/[:.]/g, '-');
  res.setHeader('Content-Disposition', `attachment; filename="nova-crm-backup-${stamp}.json"`);
  res.setHeader('Content-Type', 'application/json');
  res.send(JSON.stringify(dump, null, 2));
});

router.post('/json/save', (req, res) => {
  const filePath = writeBackupFile();
  res.json({ ok: true, path: filePath });
});

router.get('/xlsx', (req, res) => {
  const dump = buildFullDump();
  const wb = XLSX.utils.book_new();

  const leadsSheet = XLSX.utils.json_to_sheet(
    dump.leads.map((l) => ({
      ID: l.id,
      Cliente: l.client_name,
      Telefono: l.phone,
      Documento: l.document,
      Producto: l.product,
      Estado: l.status,
      Asesor_ID: l.assigned_advisor_id,
      Monto: l.amount,
      Creado: l.created_at,
      Contactado: l.contacted_at,
      Cerrado: l.closed_at,
      Reasignaciones: l.reassigned_count,
    }))
  );
  XLSX.utils.book_append_sheet(wb, leadsSheet, 'Leads');

  const ventasSheet = XLSX.utils.json_to_sheet(
    dump.leads
      .filter((l) => l.status === 'cerrado_ganado')
      .map((l) => ({ ID: l.id, Cliente: l.client_name, Producto: l.product, Monto: l.amount, Cerrado: l.closed_at, Asesor_ID: l.assigned_advisor_id }))
  );
  XLSX.utils.book_append_sheet(wb, ventasSheet, 'Ventas');

  const advisorsSheet = XLSX.utils.json_to_sheet(
    dump.advisors.map((a) => ({ ID: a.id, Nombre: a.name, Rol: a.role, Activo: a.active, Prioridad: a.priority_order }))
  );
  XLSX.utils.book_append_sheet(wb, advisorsSheet, 'Asesores');

  const slaSheet = XLSX.utils.json_to_sheet(
    dump.reassignments.map((r) => ({
      ID: r.id,
      Lead_ID: r.lead_id,
      De_Asesor: r.from_advisor_id,
      A_Asesor: r.to_advisor_id,
      Motivo: r.reason,
      Penalizacion: r.penalty_points,
      Fecha: r.at,
    }))
  );
  XLSX.utils.book_append_sheet(wb, slaSheet, 'Reasignaciones SLA');

  const informeStatsSheet = XLSX.utils.json_to_sheet(
    dump.informe_stats.map((s) => ({
      Fecha: s.fecha,
      Asesor_ID: s.advisor_id,
      Asignados: s.asignados,
      Contactados: s.contactados,
      Cotizados: s.cotizados,
      Pendientes: s.pendientes,
    }))
  );
  XLSX.utils.book_append_sheet(wb, informeStatsSheet, 'Informe Diario');

  const informeVentasSheet = XLSX.utils.json_to_sheet(
    dump.informe_ventas.map((v) => ({
      ID: v.id,
      Fecha: v.fecha,
      Asesor_ID: v.advisor_id,
      Cliente: v.cliente,
      Monto: v.monto,
      Creado: v.created_at,
    }))
  );
  XLSX.utils.book_append_sheet(wb, informeVentasSheet, 'Informe Ventas');

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const stamp = dump.exported_at.replace(/[:.]/g, '-');
  res.setHeader('Content-Disposition', `attachment; filename="nova-crm-export-${stamp}.xlsx"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
});

module.exports = router;
