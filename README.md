# nodednsdock
DNS Server for Docker 1.10 in Nodejs

# To Install

```
docker build -t ryarnyah/nodednsdock .
docker run -d -v /var/run/docker.sock:/var/run/docker.sock -p 53:53/udp ryarnyah/nodednsdock
```
