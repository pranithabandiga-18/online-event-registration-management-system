pipeline {
  agent { label 'linux' }
  options { timestamps() }
  parameters {
    string(name: 'TEST_KUBE_CONTEXT', defaultValue: '', description: 'Optional isolated Kubernetes context')
    string(name: 'TEST_NAMESPACE', defaultValue: '', description: 'Optional isolated test namespace')
    string(name: 'KIND_NODE', defaultValue: '', description: 'Optional kind node container for local image import')
  }
  stages {
    stage('Checkout') {
      steps { checkout scm; sh 'git rev-parse HEAD > source-revision.txt; node --version' }
    }
    stage('Install and test') {
      steps { sh 'npm ci'; sh 'npm test' }
    }
    stage('Build image') {
      steps {
        script {
          env.IMAGE_TAG = "event-registration:${env.GIT_COMMIT.take(12)}-${env.BUILD_NUMBER}"
          sh 'docker build -t "$IMAGE_TAG" .'
        }
      }
    }
    stage('Optional isolated Kubernetes deploy') {
      when { expression { params.TEST_KUBE_CONTEXT?.trim() && params.TEST_NAMESPACE?.trim() } }
      steps {
        withEnv(["KUBE_CONTEXT=${params.TEST_KUBE_CONTEXT}", "KUBE_NAMESPACE=${params.TEST_NAMESPACE}"]) {
          sh '''
            if [ -n "$KIND_NODE" ]; then
              docker save "$IMAGE_TAG" | docker exec -i "$KIND_NODE" ctr -n k8s.io images import -
            fi
            kubectl --context "$KUBE_CONTEXT" create namespace "$KUBE_NAMESPACE" --dry-run=client -o yaml | kubectl --context "$KUBE_CONTEXT" apply -f -
            sed "s|image: event-registration:local|image: $IMAGE_TAG|" k8s/event-registration.yaml | kubectl --context "$KUBE_CONTEXT" -n "$KUBE_NAMESPACE" apply -f -
            kubectl --context "$KUBE_CONTEXT" -n "$KUBE_NAMESPACE" rollout status deployment/event-registration --timeout=180s
          '''
        }
      }
    }
  }
  post {
    always { archiveArtifacts artifacts: 'source-revision.txt', allowEmptyArchive: true }
  }
}
