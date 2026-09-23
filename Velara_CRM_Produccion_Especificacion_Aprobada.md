# VELARA CRM --- MÓDULO DE PRODUCCIÓN

## Especificación funcional aprobada para implementación con Claude Code

**Estado:** APROBADO\
**Módulo:** Producción\
**Alcance actual:** Producción únicamente\
**Inventario:** Fuera de alcance en esta fase

------------------------------------------------------------------------

# 1. OBJETIVO

Digitalizar y mejorar el proceso actual de producción que actualmente se
gestiona mediante Excel, Word/World Office y documentos físicos.

El módulo debe controlar el ciclo completo de una Orden de Producción
(OP), desde que se recibe y valida un pedido hasta su entrega y cierre.

La finalidad es responder:

-   Qué se debe fabricar.
-   Para quién.
-   Qué cantidad.
-   Qué características debe tener.
-   Qué diseño corresponde.
-   Qué tareas deben ejecutarse.
-   Quién es responsable.
-   Para cuándo debe estar listo.
-   Qué bloqueos existen.
-   En qué estado se encuentra.
-   Quién realizó cada acción.
-   Cuándo se terminó y entregó.

------------------------------------------------------------------------

# 2. REGLA ARQUITECTÓNICA PRINCIPAL

## PRODUCCIÓN E INVENTARIO DEBEN SER MÓDULOS SEPARADOS

En esta fase NO implementar lógica de inventario.

NO implementar:

-   Kardex.
-   Stock.
-   Entradas de inventario.
-   Salidas de inventario.
-   Movimientos de almacén.
-   Bodegas.
-   Ajustes de inventario.
-   Consumo automático de inventario.
-   Valorización de inventario.
-   Reservas de inventario.
-   Costeo de inventario.

Producción solamente puede registrar los materiales que necesita una
orden y generar una **Solicitud de Material**.

Ejemplo:

``` text
Producción
   ↓
OP-2026-0098
   ↓
Material requerido:
Tela técnica — 25 metros
   ↓
Crear Solicitud de Material
   ↓
Pendiente
```

El futuro módulo Inventario podrá recibir y procesar esa solicitud.

Producción NO debe descontar existencias.

------------------------------------------------------------------------

# 3. SEPARACIÓN ENTRE PEDIDO Y ORDEN DE PRODUCCIÓN

No tratar el pedido comercial y la orden de producción como la misma
entidad.

## PEDIDO COMERCIAL

Representa la solicitud originada desde Comercial.

Ejemplo:

``` text
PED-2026-00452

Cliente:
Gimnasio PowerFit

Producto:
Forros para equipos

Cantidad:
12

Fecha solicitada:
28/09/2026
```

## ORDEN DE PRODUCCIÓN

Representa la instrucción operativa para fabricar.

Ejemplo:

``` text
OP-2026-0098

Pedido relacionado:
PED-2026-00452

Cliente:
Gimnasio PowerFit

Producto:
Forros para equipos

Cantidad:
12

Fecha de entrega:
28/09/2026

Responsable:
Luis Barrios

Estado:
EN PRODUCCIÓN
```

Una relación debe permitir:

``` text
1 Pedido → 1 o varias Órdenes de Producción
```

------------------------------------------------------------------------

# 4. FLUJO OFICIAL DE PRODUCCIÓN

Este flujo queda APROBADO como flujo principal:

``` text
PEDIDO RECIBIDO
       ↓
POR VALIDAR
       ↓
¿INFORMACIÓN COMPLETA?
   ↓              ↓
  NO              SÍ
   ↓              ↓
Solicitar       CREAR OP
información        ↓
                   ↓
           ASIGNAR CONSECUTIVO
                   ↓
           PROGRAMAR PRODUCCIÓN
                   ↓
          REVISAR REQUERIMIENTOS
                   ↓
            ¿HAY BLOQUEO?
              ↓        ↓
             SÍ        NO
              ↓        ↓
         PAUSAR OP    INICIAR
              ↓       PRODUCCIÓN
              ↓          ↓
              └────→ EN PRODUCCIÓN
                          ↓
                    CONTROL / REVISIÓN
                          ↓
                  ¿PRODUCCIÓN APROBADA?
                     ↓           ↓
                    NO           SÍ
                     ↓           ↓
                CORRECCIÓN    LISTA PARA
                     ↓         ENTREGAR
                     └────┐       ↓
                          │    ENTREGADA
                          │       ↓
                          └──→  CERRADA
```

------------------------------------------------------------------------

# 5. ESTADOS DE LA ORDEN DE PRODUCCIÓN

Estados principales:

1.  POR VALIDAR
2.  PROGRAMADA
3.  EN PRODUCCIÓN
4.  PAUSADA
5.  CONTROL / REVISIÓN
6.  LISTA PARA ENTREGAR
7.  ENTREGADA
8.  CERRADA
9.  CANCELADA

No permitir cambios arbitrarios de estado sin registrar usuario, fecha,
hora y motivo cuando corresponda.

------------------------------------------------------------------------

# 6. CONSECUTIVO AUTOMÁTICO

El sistema debe generar automáticamente:

``` text
OP-2026-0001
OP-2026-0002
OP-2026-0003
...
```

El usuario NO debe escribir manualmente el número de OP.

El consecutivo debe ser único.

------------------------------------------------------------------------

# 7. DATOS PRINCIPALES DE LA OP

La Orden de Producción debe contener como mínimo:

-   ID interno.
-   Número OP.
-   Pedido relacionado.
-   Cliente.
-   Contacto.
-   Teléfono.
-   Dirección.
-   Destino.
-   Producto.
-   Código de producto.
-   Cantidad.
-   Unidad.
-   Fecha de recepción.
-   Fecha de entrega solicitada.
-   Fecha de entrega comprometida.
-   Prioridad.
-   Responsable de producción.
-   Asesor comercial.
-   Estado.
-   Observaciones.
-   Fecha de creación.
-   Fecha de actualización.

------------------------------------------------------------------------

# 8. ESTRUCTURA DE LA ORDEN

La vista de detalle de una OP debe organizarse en pestañas o secciones.

## 8.1 RESUMEN

Mostrar:

-   Número OP.
-   Cliente.
-   Pedido relacionado.
-   Producto.
-   Cantidad.
-   Estado.
-   Responsable.
-   Asesor.
-   Fecha de entrega.
-   Progreso.
-   Alertas.
-   Bloqueos.

Debe ser la primera vista.

------------------------------------------------------------------------

# 9. PRODUCTO

Registrar:

-   Producto.
-   Código.
-   Cantidad.
-   Unidad.
-   Medidas.
-   Color.
-   Acabado.
-   Características.
-   Observaciones.

------------------------------------------------------------------------

# 10. ESPECIFICACIONES TÉCNICAS

Debe permitir registrar información específica de fabricación:

-   Medidas.
-   Materiales.
-   Características.
-   Acabados.
-   Detalles técnicos.
-   Instrucciones especiales.
-   Observaciones.

Los campos deben poder crecer en el futuro sin obligar a rediseñar toda
la OP.

------------------------------------------------------------------------

# 11. DISEÑOS Y ARCHIVOS

Permitir adjuntar:

-   Imágenes.
-   PDF.
-   Planos.
-   Fichas técnicas.
-   Archivos de diseño.
-   Fotografías de referencia.

Debe existir control de versiones.

Ejemplo:

``` text
Diseño v1
Diseño v2
Diseño v3 ← VERSIÓN VIGENTE
```

Registrar:

-   Nombre del archivo.
-   Versión.
-   Usuario que lo cargó.
-   Fecha.
-   Observación.
-   Si es la versión vigente.

Nunca eliminar silenciosamente la trazabilidad de versiones.

------------------------------------------------------------------------

# 12. MATERIALES REQUERIDOS

IMPORTANTE:

Esta sección NO es inventario.

Debe registrar solamente los requerimientos necesarios para fabricar la
OP.

Campos:

-   Material.
-   Código opcional.
-   Cantidad requerida.
-   Unidad.
-   Observaciones.
-   Estado del requerimiento.

Estados:

-   Pendiente.
-   Solicitado.
-   Disponible.
-   Bloqueado.

## SOLICITUD DE MATERIAL

Debe existir un botón:

``` text
+ Crear solicitud de material
```

Ejemplo:

``` text
Solicitud de Material #SM-0041

OP:
OP-2026-0098

Material:
Tela técnica

Cantidad:
25 metros

Motivo:
Producción

Estado:
Pendiente
```

Esta solicitud NO modifica inventario.

------------------------------------------------------------------------

# 13. TAREAS DE PRODUCCIÓN

Cada OP puede tener múltiples tareas.

Ejemplo:

``` text
☑ Cortar material
   Responsable: Luis
   Estado: Completada

☑ Preparar piezas
   Responsable: Andrés
   Estado: Completada

□ Ensamblar
   Responsable: Carlos
   Estado: En proceso

□ Revisar
   Responsable: Supervisor
   Estado: Pendiente

□ Empacar
   Responsable: Luis
   Estado: Pendiente
```

Cada tarea debe tener:

-   Nombre.
-   Responsable.
-   Fecha prevista.
-   Fecha de inicio.
-   Fecha de finalización.
-   Estado.
-   Observaciones.

Estados:

-   Pendiente.
-   En proceso.
-   Completada.
-   Bloqueada.

Calcular automáticamente el porcentaje de progreso de la OP.

------------------------------------------------------------------------

# 14. RESPONSABLES

La OP debe tener un responsable principal de producción.

También debe permitir asignar operarios a tareas específicas.

Ejemplo:

``` text
Responsable OP:
Luis Barrios

Operarios:
Carlos
Andrés
José
Pedro
```

------------------------------------------------------------------------

# 15. BLOQUEOS

Crear un sistema específico de bloqueos.

Motivos posibles:

-   Información incompleta.
-   Diseño pendiente.
-   Aprobación pendiente.
-   Material pendiente.
-   Problema de producción.
-   Otro.

Cada bloqueo debe registrar:

-   Motivo.
-   Responsable.
-   Fecha.
-   Hora.
-   Observación.
-   Estado del bloqueo.

Ejemplo:

``` text
🔴 OP BLOQUEADA

Motivo:
Material pendiente

Responsable:
Compras

Desde:
25/09/2026

Observación:
Pendiente tela técnica.
```

Una OP bloqueada debe mostrar claramente la razón.

------------------------------------------------------------------------

# 16. FECHAS Y ALERTAS

El sistema debe comparar automáticamente la fecha actual con la fecha de
entrega.

Estados visuales:

``` text
🟢 EN TIEMPO
🟡 PRÓXIMA
🟠 EN RIESGO
🔴 VENCIDA
```

Filtros rápidos:

-   Entrega hoy.
-   Entrega mañana.
-   Entregas próximas.
-   En riesgo.
-   Vencidas.

No utilizar colores excesivamente saturados.

------------------------------------------------------------------------

# 17. DASHBOARD DE PRODUCCIÓN

El Dashboard debe ser visual, moderno y orientado a operación.

Indicadores superiores:

``` text
POR VALIDAR
PROGRAMADAS
EN PRODUCCIÓN
EN CONTROL
LISTAS PARA ENTREGAR
ENTREGADAS
EN RIESGO
BLOQUEADAS
```

Debajo debe existir un tablero Kanban.

Columnas:

``` text
POR VALIDAR
PROGRAMADAS
EN PRODUCCIÓN
CONTROL
LISTAS
ENTREGADAS
```

Cada tarjeta debe mostrar:

-   OP.
-   Cliente.
-   Producto.
-   Cantidad.
-   Responsable.
-   Fecha de entrega.
-   Estado.
-   Alertas.
-   Bloqueos.

------------------------------------------------------------------------

# 18. BÚSQUEDA Y FILTROS

Buscar por:

-   Número OP.
-   Pedido.
-   Cliente.
-   Producto.
-   Responsable.
-   Código.

Filtros:

-   Estado.
-   Responsable.
-   Fecha.
-   Prioridad.
-   Cliente.
-   Producto.

Filtros rápidos:

``` text
Entrega hoy
Entrega mañana
Vencidas
En riesgo
Bloqueadas
Sin responsable
Sin diseño
Sin aprobación
Material pendiente
```

------------------------------------------------------------------------

# 19. PROGRAMACIÓN

Crear una vista de programación.

Debe mostrar:

-   OP.
-   Cliente.
-   Producto.
-   Responsable.
-   Fecha de inicio.
-   Fecha de entrega.
-   Estado.

Preferiblemente permitir:

-   Vista calendario.
-   Vista timeline.

La programación debe facilitar detectar sobrecarga y entregas próximas.

------------------------------------------------------------------------

# 20. CONTROL / REVISIÓN

Cuando la producción termina:

``` text
EN PRODUCCIÓN
      ↓
CONTROL / REVISIÓN
```

La revisión debe poder comprobar:

-   Producto terminado.
-   Cantidad.
-   Medidas.
-   Características.
-   Acabados.
-   Diseño correcto.
-   Observaciones.

Resultado:

``` text
APROBADO
```

o

``` text
REQUIERE CORRECCIÓN
```

Si requiere corrección:

``` text
CONTROL
   ↓
CORRECCIÓN
   ↓
EN PRODUCCIÓN
```

------------------------------------------------------------------------

# 21. APROBACIONES

Registrar:

-   Asesor comercial.
-   Fecha.
-   Hora.
-   Firma.
-   Confirmación de características.
-   Confirmación de cantidades.
-   Confirmación de diseño.

La OP no debe pasar a "LISTA PARA ENTREGAR" si existe una aprobación
obligatoria pendiente.

------------------------------------------------------------------------

# 22. DOCUMENTOS

El sistema debe generar automáticamente documentos a partir de la
información de la OP.

Documentos mínimos:

-   Orden de Producción PDF.
-   Ficha de producción.
-   Documento de fabricación.

El usuario no debería tener que volver a escribir la información en
Word.

## FORMATO BÁSICO

``` text
VELARA
ORDEN DE PRODUCCIÓN

OP: OP-2026-0098
PEDIDO: PED-2026-00452

CLIENTE:
Gimnasio PowerFit

PRODUCTO:
Forros para equipos

CANTIDAD:
12

FECHA RECEPCIÓN:
23/09/2026

FECHA ENTREGA:
28/09/2026

CARACTERÍSTICAS:
...

MATERIALES:
...

DISEÑO:
...

OBSERVACIONES:
...

RESPONSABLE:
...

FIRMAS:

____________________
Asesor

____________________
Producción
```

------------------------------------------------------------------------

# 23. HISTORIAL / AUDITORÍA

Registrar automáticamente:

-   Creación.
-   Modificación.
-   Cambio de estado.
-   Asignación.
-   Cambio de fecha.
-   Carga de archivos.
-   Cambio de diseño.
-   Aprobación.
-   Bloqueo.
-   Desbloqueo.
-   Inicio de producción.
-   Finalización.
-   Entrega.
-   Cierre.

Cada evento debe guardar:

-   Usuario.
-   Fecha.
-   Hora.
-   Acción.
-   Detalle.

Ejemplo:

``` text
23 sep 08:32
Pedido recibido
Javier

23 sep 08:40
OP creada
Sistema

23 sep 08:45
OP asignada a Luis Barrios
Javier

23 sep 09:10
Producción iniciada
Luis Barrios

25 sep 16:30
Producción pausada
Motivo: material pendiente

26 sep 08:15
Producción reanudada
Luis Barrios
```

------------------------------------------------------------------------

# 24. ENTREGA

Cuando la OP termina:

``` text
LISTA PARA ENTREGAR
```

Registrar:

-   Fecha de finalización.
-   Responsable.
-   Revisión realizada.
-   Observaciones.
-   Autorización.
-   Documentos.

Después:

``` text
ENTREGADA
```

Registrar:

-   Fecha de entrega.
-   Responsable.
-   Observaciones.

Finalmente:

``` text
CERRADA
```

------------------------------------------------------------------------

# 25. REPORTES DE PRODUCCIÓN

Crear posteriormente reportes con:

-   Órdenes recibidas.
-   Órdenes programadas.
-   Órdenes en producción.
-   Órdenes terminadas.
-   Órdenes entregadas.
-   Órdenes retrasadas.
-   Órdenes bloqueadas.
-   Producción por responsable.
-   Producción por período.
-   Tiempo de producción.
-   Cumplimiento de fechas.

------------------------------------------------------------------------

# 26. ESTRUCTURA CONCEPTUAL DE DATOS

Arquitectura conceptual:

``` text
CUSTOMER / CLIENTE
        │
        ▼
PEDIDO COMERCIAL
        │
        │ 1:N
        ▼
ORDEN DE PRODUCCIÓN
        │
        ├── production_items
        │
        ├── technical_specifications
        │
        ├── designs
        │
        ├── material_requirements
        │
        ├── production_tasks
        │
        ├── production_assignments
        │
        ├── approvals
        │
        ├── documents
        │
        ├── delivery
        │
        ├── blocks
        │
        └── activity_log
```

------------------------------------------------------------------------

# 27. PRINCIPIOS DE IMPLEMENTACIÓN

1.  No duplicar información innecesariamente.
2.  Reutilizar entidades existentes del CRM cuando corresponda.
3.  Mantener relación entre Pedido y OP.
4.  Toda OP debe tener trazabilidad.
5.  Todos los cambios importantes deben generar historial.
6.  No eliminar registros críticos físicamente si afectan auditoría.
7.  El número de OP es automático.
8.  Las fechas generan alertas.
9.  Una OP puede tener múltiples tareas.
10. Una OP puede tener múltiples archivos.
11. Una OP puede tener múltiples versiones de diseño.
12. Una OP puede tener múltiples requerimientos de materiales.
13. Una OP puede tener múltiples bloqueos a lo largo de su ciclo.
14. Las aprobaciones deben quedar registradas.
15. La interfaz debe ser responsive.
16. La arquitectura debe permitir conectar Inventario en el futuro sin
    mezclar ambos módulos.
17. No implementar funciones de Inventario en esta fase.

------------------------------------------------------------------------

# 28. PRIORIDAD DE DESARROLLO

## FASE 1 --- ARQUITECTURA

-   Analizar arquitectura existente.
-   Analizar base de datos existente.
-   Identificar entidades reutilizables.
-   Diseñar relaciones.
-   Definir permisos.
-   Definir estados.

## FASE 2 --- ORDEN DE PRODUCCIÓN

-   Crear OP.
-   Editar OP.
-   Consecutivo automático.
-   Relación con pedido.
-   Cliente.
-   Producto.
-   Fechas.
-   Responsables.

## FASE 3 --- FLUJO

-   Estados.
-   Transiciones.
-   Validaciones.
-   Historial.

## FASE 4 --- DASHBOARD

-   KPIs.
-   Kanban.
-   Alertas.
-   Búsqueda.
-   Filtros.

## FASE 5 --- TAREAS

-   Tareas.
-   Operarios.
-   Responsables.
-   Progreso.

## FASE 6 --- DISEÑOS Y DOCUMENTOS

-   Archivos.
-   Versiones.
-   PDF.
-   Ficha de producción.

## FASE 7 --- MATERIALES

-   Requerimientos.
-   Solicitudes de material.
-   SIN modificar inventario.

## FASE 8 --- APROBACIONES

-   Firma.
-   Validaciones.
-   Autorizaciones.

## FASE 9 --- BLOQUEOS

-   Motivos.
-   Responsables.
-   Alertas.
-   Historial.

## FASE 10 --- REPORTES

-   Producción.
-   Cumplimiento.
-   Responsables.
-   Tiempos.
-   Entregas.

------------------------------------------------------------------------

# 29. INSTRUCCIÓN PARA CLAUDE CODE

Antes de modificar código:

1.  Analiza el proyecto existente.
2.  Identifica framework, estructura, rutas, componentes y base de
    datos.
3.  Identifica cómo están implementados actualmente Comercial, Taller y
    Órdenes de trabajo.
4.  No reemplaces funcionalidades existentes sin verificar dependencias.
5.  Reutiliza componentes y patrones existentes cuando sea correcto.
6.  Propón primero la arquitectura técnica.
7.  Propón las entidades y relaciones.
8.  Propón las rutas/pantallas.
9.  Propón los permisos.
10. Propón las migraciones necesarias.
11. Después implementa por fases.

NO comenzar creando código indiscriminadamente.

Primero presentar un plan técnico basado en el proyecto real.

------------------------------------------------------------------------

# 30. LÍMITE DE ESTA FASE

El alcance aprobado en esta etapa es exclusivamente:

``` text
PRODUCCIÓN
```

Inventario queda fuera del alcance.

La única interacción conceptual permitida con Inventario es:

``` text
PRODUCCIÓN
    ↓
SOLICITUD DE MATERIAL
    ↓
INVENTARIO (FUTURO MÓDULO)
```

No implementar todavía el lado de Inventario.

------------------------------------------------------------------------

# 31. FLUJO RESUMIDO APROBADO

``` text
PEDIDO RECIBIDO
      ↓
POR VALIDAR
      ↓
¿INFORMACIÓN COMPLETA?
   ↙             ↘
 NO               SÍ
 ↓                 ↓
Solicitar       CREAR OP
información        ↓
                   ↓
             PROGRAMAR
                   ↓
          REVISAR REQUERIMIENTOS
                   ↓
             ¿HAY BLOQUEO?
              ↙         ↘
             SÍ          NO
             ↓            ↓
          PAUSADA    EN PRODUCCIÓN
                          ↓
                   CONTROL / REVISIÓN
                          ↓
                  ¿APROBADA?
                    ↙       ↘
                   NO        SÍ
                   ↓          ↓
              CORRECCIÓN   LISTA PARA
                   ↓         ENTREGAR
                   └────┐      ↓
                        │   ENTREGADA
                        │      ↓
                        └── CERRADA
```

**Este documento representa la especificación funcional aprobada para
comenzar el desarrollo del módulo Producción de Velara CRM.**
