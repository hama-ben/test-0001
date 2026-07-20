#!/usr/bin/env bash
# Wrapper: sets env and runs pace-login.mjs with output to /tmp/pace-login.log
export BASE_URL=https://test-0001.onrender.com
cd /home/runner/workspace/mizu-load-test
exec /nix/store/jfar9wnj6kvr0gr6klh1gk7vgckkfr5j-nodejs-20.20.0/bin/node pace-login.mjs
