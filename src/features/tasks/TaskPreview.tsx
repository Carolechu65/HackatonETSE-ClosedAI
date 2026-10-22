import { StyleSheet, Text, View } from 'react-native';
import { demoTask, type HouseholdTask } from './model';

export function TaskPreview({ task = demoTask }: { task?: HouseholdTask }) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Tarea · demostración</Text>
      <Text>{task.title}</Text>
      <Text>Responsable: {task.assignedTo}</Text>
      <Text>Estado: {task.status === 'pending' ? 'Pendiente' : task.status === 'completed' ? 'Completada' : 'Cancelada'}</Text>
      <Text style={styles.note}>P6: conectar tareas, horarios y alarmas vinculadas.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: 6, padding: 16, borderRadius: 12, backgroundColor: '#edf3ff' },
  title: { fontSize: 17, fontWeight: '600' },
  note: { color: '#536070' },
});
