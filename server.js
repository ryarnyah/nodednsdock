var dnsd = require('dnsd');
var Docker = require('dockerode');
var async = require('async');

var docker = new Docker({
  socketPath: '/var/run/docker.sock'
});

/* Entrées DNS du domaine Docker */
var entries = [];

/* Configuration du serveur DNS */
var configuration = {
  /* Nom du domaine docker */
  domain: process.env.DOCKER_DOMAIN_DNS || ".docker.lan",
  /* IP du DNS */
  dnsServerIp: process.env.DOCKER_IP_DNS || "0.0.0.0",
  /* Port du serveur DNS */
  dnsServerPort: process.env.DOCKER_PORT_DNS || 53,
  /* Délai de rafraichissement de la liste des containers docker */
  dockerDnsReload: process.env.DOCKER_RELOAD_TIME_DNS || 10000
};

/**
 * Permet de générer la réponse à la demande PTR
 */
function loadInaddrArpa(ip) {
  var ips = ip.split('.');
  return ips[3] + '.' + ips[2] + '.' + ips[1] + '.' + ips[0] + '.in-addr.arpa';
}

/**
 * Rechargement des containers
 */
function reload_containers() {
  /* Données par default du serveur DNS */
  var container_entries = [
    {
      domain: loadInaddrArpa(configuration.dnsServerIp),
      records: [
        { type: "PTR", class: "IN", data: 'ns1' + configuration.domain }
      ]
    },
    {
      domain: '^ns1' + configuration.domain + '$',
      records: [
        { name: 'ns1', type: "CNAME", data: 'ns1' + configuration.domain, ttl: 1800 },
        { type: "A", data: configuration.dnsServerIp, ttl: 1800 },
      ]
    }
  ];

  /* Chargement de la liste des containers */
  docker.listContainers(function(err, containers) {
    if(containers.length) {
      containers.forEach(function(container) {
        /* Création de l'entrée DNS */
        var container_name = container.Names[0].split("/")[1];
        var container_entry = {
          domain: "^" + container_name + configuration.domain + "$",
          records: [{
            name: container_name, type: "CNAME", data: container_name + configuration.domain, ttl: 1800
          }]
        };

        /* Chargement des différentes IP */
        for(networkKey in container.NetworkSettings.Networks) {
          var network = container.NetworkSettings.Networks[networkKey];
          if(typeof(network) === 'object' && !(network instanceof Array)) {
            container_entry.records.push({
              type: "A", data: network.IPAddress, ttl: 1800
            });

            /* Ajout des données PTR */
            container_entries.push({
              domain: loadInaddrArpa(network.IPAddress),
              records: [
                { type: "PTR", class: "IN", data: container_name + configuration.domain }
              ]
            });

          } else if(network instanceof Array) {
            network.forEach(function(net) {
              container_entry.records.push({
                type: "A", data: net.IPAddress, ttl: 1800
              });

              /* Ajout des données PTR */
              container_entries.push({
                domain: loadInaddrArpa(network.IPAddress),
                records: [
                  { type: "PTR", class: "IN", data: container_name + configuration.domain }
                ]
              });
            });
          }
        }
        container_entries.push(container_entry);
      });
      /* Ecrasement des données DNS précédentes */
      entries = container_entries;
    }
  });
}
/* Chargement initial des containers */
reload_containers();
/* Rechargement des container toutes les 5s */
setInterval(reload_containers, configuration.dockerDnsReload);

/**
 * Permet de copier un objet.
 */
function clone(object) {
  return JSON.parse(JSON.stringify(object));
}

/**
 * Permet de traiter une requete DNS.
 */
function handleRequest(request, response) {
  var asyncFunctions = [];

  if(request.question) {
    request.question.forEach(function(question) {
      asyncFunctions.push(function(callback) {
        var entry = entries.filter(function(entry) {
          return new RegExp(entry.domain, 'i').exec(question.name);
        });
        if (entry.length) {
          var record = entry[0].records.filter(function(r) {
            return r.type === question.type;
          });
          if(record.length) {
            var recordAnswer = clone(record[0]);
            recordAnswer.name = question.name;
            recordAnswer.ttl = record.ttl || 1800;
            response.answer.push(recordAnswer);
          }
        }
        callback(null);
      });
    });
  }
  async.parallel(asyncFunctions, function (err, result) {
    response.end();
  });
}

var server = dnsd.createServer(handleRequest);
server.zone(configuration.domain, 'ns1' + configuration.domain, 'admin@' + configuration.domain, 'now', '2h', '30m', '2w', '10m');

server.on('error', function(err) {
  console.log(err);
});

server.listen(configuration.dnsServerPort, "0.0.0.0");
