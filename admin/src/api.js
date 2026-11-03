// REST-Zugriffe. Fehler tragen denselben Code wie die Antworten des Servers.

export class ApiError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

const MESSAGES = {
  not_found: "Das gibt es nicht mehr. Lade die Seite neu.",
  wrong_project: "Diese Szene gehört nicht zum aktiven Projekt.",
  scene_active: "Die laufende Szene kann nicht gelöscht werden. Wechsle zuerst die Szene.",
  asset_in_use: "Die Datei wird noch verwendet. Entferne sie zuerst aus allen Szenen und Effekten.",
  invalid_value: "Dieser Wert ist nicht erlaubt.",
  unauthorized: "Die Anmeldung ist abgelaufen.",
  internal: "Der Server konnte das nicht ausführen. Sieh im Terminal nach.",
  offline: "Keine Verbindung zum Server.",
};

export function errorMessage(error) {
  return MESSAGES[error && error.code] || MESSAGES.internal;
}

let unauthorizedHandler = () => {};

export function setUnauthorizedHandler(handler) {
  unauthorizedHandler = handler;
}

async function failure(response) {
  const body = await response.json().catch(() => ({}));
  const code = body.code || "internal";
  if (code === "unauthorized") unauthorizedHandler();
  return new ApiError(code);
}

export async function api(method, path, body) {
  let response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("offline");
  }
  if (!response.ok) throw await failure(response);
  return response.json();
}

// Nutzt XHR, weil fetch den Fortschritt eines Uploads nicht meldet.
export function uploadFile(file, onProgress) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", file, file.name);

    const request = new XMLHttpRequest();
    request.open("POST", "/api/assets");
    request.responseType = "json";
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) onProgress(event.loaded / event.total);
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        resolve(request.response);
      } else {
        const code = (request.response && request.response.code) || "internal";
        if (code === "unauthorized") unauthorizedHandler();
        reject(new ApiError(code));
      }
    };
    request.onerror = () => reject(new ApiError("offline"));
    request.send(form);
  });
}

export function assetUrl(assetId) {
  return `/api/assets/${assetId}`;
}
