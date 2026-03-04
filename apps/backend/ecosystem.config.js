module.exports = {
    apps : [{
      name: "backend-despachos",
      script: "./venv/Scripts/python.exe",
      args: "-m flask run --host=0.0.0.0 --port=5000",
      env: {
        FLASK_APP: "apps.backend.src.app:create_app",
        FLASK_DEBUG: "1"
      }
    },
    {
      name: "frontend-despachos",
      script: "serve",
      args: "-s apps/frontend/dist -l 5173",
      env: {
        PM2_SERVE_PATH: '.',
        PM2_SERVE_PORT: 5173
      }
    }]
  }