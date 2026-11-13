// Alta de usuarios desde "Gestión de permisos".
//
// Por qué vive acá y no en el front: crear un usuario necesita la clave
// service_role, y la app es un sitio estático — cualquier clave que pusiéramos
// ahí quedaría a la vista de todo el mundo. Esta función corre en el servidor:
// verifica que quien llama sea un analista habilitado y recién entonces crea al
// usuario y le manda la invitación por mail para que elija su contraseña.

import { createClient } from 'jsr:@supabase/supabase-js@2';

// EL NAVEGADOR PREGUNTA PRIMERO, Y SI UNA CABECERA NO ESTA EN LA LISTA EL
// PEDIDO NO SALE. Paso de verdad: el 21/10 el cliente de Supabase se empezo a
// crear con `x-sucursal`, y el SDK la manda TAMBIEN a las Edge Functions, asi
// que el alta de usuarios quedo muerta desde ese dia — con un cartel que dice
// "Failed to send a request to the Edge Function", que no nombra CORS y manda
// a buscar el problema a la red. En el log se ve exacto: OPTIONS 200 y ningun
// POST detras.
//
// Por eso la lista NO se escribe a mano: se devuelve la que el navegador pide,
// con la fija como piso. Una cabecera global nueva no puede volver a romper
// esto en silencio. Y no afloja nada: el corte de esta funcion es el JWT que
// se verifica abajo, no el CORS — y sin `Allow-Credentials` el navegador no
// manda la cookie de nadie, asi que permitir una cabecera no autoriza a nadie.
const CORS_FIJAS = 'authorization, x-client-info, apikey, content-type';
function corsDe(req: Request) {
  const pedidas = req.headers.get('Access-Control-Request-Headers');
  return {
    'Access-Control-Allow-Origin': '*',
    // Sin juntar, la lista sale repetida: el navegador PIDE tambien las fijas,
    // y una respuesta que nombra todo dos veces se lee como un error.
    'Access-Control-Allow-Headers': [...new Set(
      (CORS_FIJAS + (pedidas ? ', ' + pedidas : '')).split(',').map((h) => h.trim().toLowerCase()).filter(Boolean)
    )].join(', '),
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    // Sin esto, un cache intermedio podria servir la respuesta de un preflight
    // que pidio OTRAS cabeceras.
    'Vary': 'Access-Control-Request-Headers',
  };
}

Deno.serve(async (req: Request) => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsDe(req), 'Content-Type': 'application/json' } });

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsDe(req) });
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);

  try {
    const url     = Deno.env.get('SUPABASE_URL')!;
    const anon    = Deno.env.get('SUPABASE_ANON_KEY')!;
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const auth = req.headers.get('Authorization') || '';
    if (!auth) return json({ error: 'Falta la sesión' }, 401);

    // 1) ¿Quién está llamando? (se resuelve con el token de la sesión, no con lo que mande el body)
    const sbUser = createClient(url, anon, { global: { headers: { Authorization: auth } } });
    const { data: quien, error: eQuien } = await sbUser.auth.getUser();
    if (eQuien || !quien?.user) return json({ error: 'Sesión inválida o vencida' }, 401);

    // 2) ¿Es analista y está habilitado? Se consulta con service_role para que la
    //    respuesta no dependa de las policies del que llama.
    const admin = createClient(url, service);
    const { data: perfil } = await admin
      .from('perfiles').select('rol,activo').eq('id', quien.user.id).maybeSingle();
    if (!perfil || perfil.rol !== 'analista' || perfil.activo === false) {
      return json({ error: 'Solo un analista habilitado puede dar de alta usuarios' }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const email      = String(body.email  || '').trim().toLowerCase();
    const nombre     = String(body.nombre || '').trim();
    const rol        = String(body.rol    || 'administrativo').trim();
    const redirectTo = String(body.redirectTo || '').trim() || undefined;

    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'El email no es válido' }, 400);

    // 3) El rol tiene que existir de verdad (tabla roles + los dos del código).
    const { data: roles } = await admin.from('roles').select('rol');
    const validos = (roles || []).map((r: { rol: string }) => r.rol).concat(['analista', 'administrativo']);
    if (!validos.includes(rol)) return json({ error: 'Ese rol no existe: ' + rol }, 400);

    // 4) ¿Ya está dado de alta?
    const { data: repetido } = await admin
      .from('perfiles').select('id').eq('email', email).maybeSingle();
    if (repetido) return json({ error: 'Ese usuario ya existe' }, 409);

    // 5) Invitación: el usuario elige su propia contraseña (nadie más la conoce).
    const { data: inv, error: eInv } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: { nombre },
    });
    if (eInv) {
      const msg = String(eInv.message || eInv);
      if (/already been registered|already exists/i.test(msg)) return json({ error: 'Ese usuario ya existe' }, 409);
      if (/rate|limit|seconds/i.test(msg)) return json({ error: 'Se mandaron muchos mails seguidos. Esperá unos minutos.' }, 429);
      return json({ error: msg }, 400);
    }

    // 6) El trigger creó el perfil deshabilitado y como administrativo: acá le
    //    ponemos el rol elegido y lo habilitamos.
    const nuevoId = inv?.user?.id;
    if (nuevoId) {
      await admin.from('perfiles')
        .update({ nombre: nombre || email.split('@')[0], rol, activo: true })
        .eq('id', nuevoId);
    }

    return json({ ok: true, id: nuevoId, email, rol });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
