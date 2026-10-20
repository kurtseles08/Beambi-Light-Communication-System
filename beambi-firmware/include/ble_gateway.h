#pragma once
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLE2902.h>
#include <freertos/queue.h>

// Nordic UART GATT service. Wi-Fi is never started, leaving ADC2 available.
static constexpr char BLE_SERVICE[] = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
static constexpr char BLE_RX[] = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
static constexpr char BLE_TX[] = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";
struct BleReport { uint32_t ts; char json[2048]; };
struct BleCommand { char json[256]; };
static QueueHandle_t bleReports[2] = {nullptr, nullptr}, bleCommands = nullptr;
static BLECharacteristic *bleTx = nullptr;
static volatile bool bleConnected = false;
static volatile uint16_t bleMtu = 23;

class GatewayCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer *) override { bleMtu = 23; bleConnected = true; }
  void onMtuChanged(BLEServer *, esp_ble_gatts_cb_param_t *param) override {
    bleMtu = param->mtu.mtu;
  }
  void onDisconnect(BLEServer *) override {
    bleConnected = false;
    BLEDevice::startAdvertising();
  }
};
class CommandCallbacks : public BLECharacteristicCallbacks {
  String pending;
  bool overflow = false;
  void onWrite(BLECharacteristic *characteristic) override {
    std::string value = characteristic->getValue();
    for (char c : value) {
      if (c == '\n') {
        if (!overflow && pending.length()) {
          BleCommand command;
          pending.toCharArray(command.json, sizeof(command.json));
          xQueueSend(bleCommands, &command, 0);
        }
        pending = ""; overflow = false;
      } else if (pending.length() < 255) pending += c;
      else overflow = true;
    }
  }
};

// Notifications run outside the sample and LoRa loops. One latest report per unit.
static void bleSendLoop(void *) {
  BleReport report;
  for (;;) {
    for (auto queue : bleReports) {
      if (xQueueReceive(queue, &report, 0) != pdTRUE) continue;
      if (!bleConnected || millis() - report.ts > 2000) continue;
      // A leading newline discards an incomplete previous notification sequence.
      bleTx->setValue((uint8_t *)"\n", 1); bleTx->notify();
      vTaskDelay(pdMS_TO_TICKS(5));
      size_t length = strlen(report.json);
      for (size_t i = 0; i < length && bleConnected;) {
        size_t capacity = bleMtu > 23 ? bleMtu - 3 : 20;
        if (capacity > 180) capacity = 180;
        size_t chunk = length - i < capacity ? length - i : capacity;
        bleTx->setValue((uint8_t *)report.json + i, chunk);
        bleTx->notify();
        i += chunk;
        vTaskDelay(pdMS_TO_TICKS(5)); // Works at the default ATT MTU as well.
      }
    }
    vTaskDelay(pdMS_TO_TICKS(10));
  }
}

static void publishBluetooth(JsonDocument &status) {
  if (!bleConnected || !bleTx) return;
  BleReport report;
  if (measureJson(status) + 2 > sizeof(report.json)) return;
  report.ts = millis();
  size_t length = serializeJson(status, report.json, sizeof(report.json));
  report.json[length++] = '\n'; report.json[length] = 0;
  xQueueOverwrite(bleReports[status["unit"] == "B" ? 1 : 0], &report);
}

static bool startBluetoothGateway() {
  bleReports[0] = xQueueCreate(1, sizeof(BleReport));
  bleReports[1] = xQueueCreate(1, sizeof(BleReport));
  bleCommands = xQueueCreate(20, sizeof(BleCommand));
  if (!bleReports[0] || !bleReports[1] || !bleCommands) return false;
  BLEDevice::init("BeamBi-A");
  BLEDevice::setMTU(185);
  BLEServer *server = BLEDevice::createServer();
  server->setCallbacks(new GatewayCallbacks());
  BLEService *service = server->createService(BLE_SERVICE);
  bleTx = service->createCharacteristic(BLE_TX, BLECharacteristic::PROPERTY_NOTIFY);
  bleTx->addDescriptor(new BLE2902());
  BLECharacteristic *rx = service->createCharacteristic(BLE_RX, BLECharacteristic::PROPERTY_WRITE);
  rx->setCallbacks(new CommandCallbacks());
  service->start();
  if (xTaskCreatePinnedToCore(bleSendLoop, "ble-reports", 6144, nullptr, 1, nullptr, 1) != pdPASS)
    return false;
  BLEAdvertising *advertising = BLEDevice::getAdvertising();
  advertising->addServiceUUID(BLE_SERVICE);
  advertising->setScanResponse(true);
  advertising->start();
  return true;
}
