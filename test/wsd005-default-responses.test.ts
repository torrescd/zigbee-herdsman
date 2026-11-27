import {EventEmitter} from "node:events";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import type {Adapter, Events} from "../src/adapter";
import type Device from "../src/controller/model/device";
import Endpoint from "../src/controller/model/endpoint";
import Entity from "../src/controller/model/entity";
import * as Zcl from "../src/zspec/zcl";

describe("movement Default Responses", () => {
    const address = 1234;
    const clusterID = Zcl.Clusters.closuresWindowCovering.ID;
    const send = vi.fn<Adapter["sendZclFrameToEndpoint"]>();
    const adapter = Object.assign(new EventEmitter(), {sendZclFrameToEndpoint: send});
    let endpoint: Endpoint;

    function packet(hex: string, overrides: Partial<Events.ZclPayload> = {}): Events.ZclPayload {
        const data = Buffer.from(hex, "hex");
        return {
            data,
            header: Zcl.Header.fromBuffer(data),
            address,
            endpoint: 1,
            destinationEndpoint: 1,
            clusterID,
            groupID: 0,
            wasBroadcast: false,
            linkquality: 180,
            ...overrides,
        };
    }

    function move(): ReturnType<Endpoint["command"]> {
        return endpoint.command("closuresWindowCovering", "goToLiftPercentage", {percentageliftvalue: 50}, {transactionSequenceNumber: 1});
    }

    beforeEach(() => {
        vi.useFakeTimers();
        send.mockReset();
        Entity.injectAdapter(adapter as unknown as Adapter);
        endpoint = Endpoint.create(1, 260, 514, [clusterID], [], address, "0x1234");
        vi.spyOn(endpoint, "getDevice").mockReturnValue({
            modelID: "WSD005",
            manufacturerName: "Adeo",
            customClusters: {},
            pendingRequestTimeout: 0,
        } as Device);
    });

    afterEach(() => {
        expect(adapter.listenerCount("zclPayload")).toBe(0);
        expect(send).toHaveBeenCalledTimes(1);
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it.each([
        {description: "failed 50% move", first: "08010b0501", report: "18160a08002032", second: "08010b0500", nextAfter: 116, open: false},
        {
            description: "physically successful full opening",
            first: "08090b0001",
            report: "18620a08002032",
            second: "08090b0000",
            nextAfter: 31,
            open: true,
        },
        {description: "success arriving first", first: "08010b0500", report: "18160a08002032", second: "08010b0501", nextAfter: 10, open: false},
    ])("reports conflicting replies for $description", async ({first, report, second, nextAfter, open}) => {
        send.mockImplementation((_ieee, _nwk, _ep, frame) => {
            expect(frame.toBuffer().toString("hex")).toBe(open ? "010900" : "01010532");
            if (open) adapter.emit("zclPayload", packet(report));
            adapter.emit("zclPayload", packet(first));
            if (!open) setTimeout(() => adapter.emit("zclPayload", packet(report)), 5);
            setTimeout(() => adapter.emit("zclPayload", packet(second)), nextAfter);
            return Promise.resolve(packet(first));
        });
        const result = open ? endpoint.command("closuresWindowCovering", "upOpen", {}, {transactionSequenceNumber: 9}) : move();
        const checked = expect(result).rejects.toThrow(/conflicting Default Responses.*(FAILURE, SUCCESS|SUCCESS, FAILURE)/);
        await vi.advanceTimersByTimeAsync(500);
        await checked;
    });

    it("accepts matching duplicate successes and ignores unrelated failures", async () => {
        const ok = packet("08010b0500");
        send.mockImplementation(() => {
            for (const unrelated of [
                packet("08010b0501", {address: address + 1}),
                packet("08010b0501", {endpoint: 2}),
                packet("08010b0501", {clusterID: 6}),
                packet("08020b0501"),
                packet("08010b0001"),
                packet("00010b0501"),
                packet("08010b0501", {wasBroadcast: true}),
                packet("18010a08002032"),
            ])
                adapter.emit("zclPayload", unrelated);
            adapter.emit("zclPayload", ok);
            return Promise.resolve(ok);
        });
        const checked = expect(move()).resolves.toEqual({cmdId: 5, statusCode: 0});
        await vi.advanceTimersByTimeAsync(500);
        await checked;
    });

    it("rejects a lone failure after the collection window", async () => {
        send.mockResolvedValue(packet("08010b0501"));
        const checked = expect(move()).rejects.toThrow(/FAILURE/);
        await vi.advanceTimersByTimeAsync(500);
        await checked;
    });

    it("removes its listener on transport failure", async () => {
        send.mockRejectedValue(new Error("transmit failed"));
        await expect(move()).rejects.toThrow(/transmit failed/);
    });

    it("does not treat an unrelated response from the adapter as success", async () => {
        send.mockResolvedValue(packet("08010b0000"));
        const checked = expect(move()).rejects.toThrow(/No matching WSD005/);
        await vi.advanceTimersByTimeAsync(500);
        await checked;
    });

    it("collects conflicts even when both frames arrive before the send promise settles", async () => {
        send.mockImplementation(() => {
            adapter.emit("zclPayload", packet("08010b0500"));
            adapter.emit("zclPayload", packet("08010b0501"));
            return Promise.resolve(packet("08010b0500"));
        });
        await expect(move()).rejects.toThrow(/conflicting Default Responses/);
    });

    it("propagates a failed Default Response on an ordinary endpoint command", async () => {
        send.mockResolvedValue(packet("08090b0201"));
        await expect(endpoint.command("closuresWindowCovering", "stop", {}, {transactionSequenceNumber: 9})).rejects.toThrow(/FAILURE/);
    });
});
