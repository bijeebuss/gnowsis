FROM temporalio/temporal@sha256:2c344b4a39b4489fc6944db095f628f0c30659836faf11780a4dc435599e80e3

EXPOSE 7233 8233
CMD ["server", "start-dev", "--ip", "0.0.0.0", "--db-filename", "/data/temporal.db", "--ui-port", "8233"]
