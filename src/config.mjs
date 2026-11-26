export const PORT = Number(process.env.PORT ?? 8787);

export const INSIGHTS_QUERIES = [
  {
    key: 'trace',
    label: 'Traza por correlationId',
    description: 'Toda la vida de un journey en todos los servicios, en orden.',
    groups: ['journey', 'psu', 'integration', 'cognito', 'audit', 'token-issuer'],
    query: 'fields @timestamp, @log, level, message, code\n| filter correlationId = "{{correlationId}}" or metadata.correlationId = "{{correlationId}}"\n| sort @timestamp asc\n| limit 300',
  },
  {
    key: 'errors',
    label: 'Errores por servicio',
    description: 'ERROR y WARN agrupados por servicio en la ventana elegida.',
    groups: ['journey', 'psu', 'integration', 'cognito', 'audit', 'token-issuer', 'authorizer'],
    query: 'fields @log, level\n| filter level in ["ERROR", "WARN"]\n| stats count(*) as total by @log, level\n| sort total desc',
  },
  {
    key: 'http',
    label: 'Respuestas HTTP del journey',
    description: 'Llamadas al BFF agrupadas por código de respuesta, sin health checks.',
    groups: ['journey'],
    query: 'fields message\n| filter message like /inbound response/ and message not like /actuator/\n| parse message "status=*," as status\n| stats count(*) as llamadas by status\n| sort llamadas desc',
  },
  {
    key: 'tokens',
    label: 'Desenlaces del token-issuer',
    description: 'Handoff, init y resume por código: emitidos, firmas rechazadas y repeticiones.',
    groups: ['token-issuer'],
    query: 'fields code\n| filter ispresent(code)\n| stats count(*) as total by code\n| sort total desc',
  },
  {
    key: 'states',
    label: 'Estados leídos del journey',
    description: 'Estados del journey vistos en las lecturas de DynamoDB.',
    groups: ['journey'],
    query: 'fields message\n| filter message like /JourneyDynamoAdapter.findById/\n| parse message /"state":"(?<state>[A-Z_]+)"/\n| stats count(*) as lecturas by state\n| sort lecturas desc',
  },
];
