FROM semtech/mu-javascript-template:1.9.1
LABEL maintainer="Redpencil <info@redpencil.io>"
ENV SUDO_QUERY_RETRY="true"
ENV SUDO_QUERY_RETRY_FOR_HTTP_STATUS_CODES="404,500,503"
ENV SUDO_QUERY_RETRY_MAX_ATTEMPTS=5
ENV ALLOW_MU_AUTH_SUDO="true"
RUN apt update
RUN apt -y install curl
