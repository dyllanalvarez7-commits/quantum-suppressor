import express from 'express';
import session from 'express-session';
import axios from 'axios';
import crypto from 'crypto';
import cors from 'cors';

const app = express();

// ⚠️ IMPORTANTE: Reemplaza esto con la URL de tu GitHub Pages
const FRONTEND_URL = 'https://dylallanavarez7-commits.github.io/quantum-suppressor';

app.use(cors({
  origin: FRONTEND_URL,
  credentials: true
}));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
  secret: process.env.SESSION_SECRET || 'secreto-super-seguro-cambiame',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    httpOnly: true, 
    secure: true, // Requerido para HTTPS (Railway y GitHub usan HTTPS)
    sameSite: 'none' // Permite que GitHub y Railway compartan la cookie
  }
}));

const CLIENT_ID = process.env.DERIV_CLIENT_ID || 'TU_CLIENT_ID_AQUI';
const REDIRECT_URI = process.env.DERIV_REDIRECT_URI || 'https://tu-app.up.railway.app/callback';
const DERIV_AUTH = 'https://auth.deriv.com/oauth2/auth';
const DERIV_TOKEN = 'https://auth.deriv.com/oauth2/token';

// 1) Redirigir a Deriv
app.get('/login', (req, res) => {
  const codeVerifier = crypto.randomBytes(64).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  const state = crypto.randomBytes(16).toString('hex');

  req.session.pkce = { codeVerifier, state };

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: 'trade',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256'
  });

  res.redirect(`${DERIV_AUTH}?${params}`);
});

// 2) Callback: Deriv devuelve el código aquí
app.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;
  
  if (error) return res.redirect(`${FRONTEND_URL}?error=${error}`);
  if (state !== req.session.pkce?.state) return res.status(400).send('State inválido');

  try {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: req.session.pkce.codeVerifier
    });

    const { data } = await axios.post(DERIV_TOKEN, body, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    req.session.accessToken = data.access_token;
    delete req.session.pkce;

    // Redirigir de vuelta a tu página de GitHub Pages
    res.redirect(FRONTEND_URL);
  } catch (e) {
    console.error(e.response?.data || e.message);
    res.status(500).send('Error en autenticación con Deriv');
  }
});

// 3) Verificar sesión
app.get('/api/me', (req, res) => {
  if (!req.session.accessToken) return res.status(401).json({ logged: false });
  res.json({ logged: true });
});

// 4) Proxy para obtener cuentas
app.get('/api/accounts', async (req, res) => {
  if (!req.session.accessToken) return res.status(401).json({ error: 'No autenticado' });
  try {
    const { data } = await axios.get('https://api.derivws.com/trading/v1/options/accounts', {
      headers: { Authorization: `Bearer ${req.session.accessToken}` }
    });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/', (req, res) => res.send('Servidor Backend funcionando correctamente.'));
app.listen(process.env.PORT || 3000, () => console.log('Servidor en puerto', process.env.PORT || 3000));
